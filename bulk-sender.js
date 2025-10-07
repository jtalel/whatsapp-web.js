const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const { Client, LocalAuth } = require('./index');

const STATUS_COLUMN = 'whatsapp_status';
const STATUS_MESSAGE_COLUMN = 'whatsapp_status_message';
const STATUS_LAST_CHECKED_COLUMN = 'whatsapp_last_checked';

const STATUS_VALUES = {
    invalid: 'INVALID_NUMBER',
    notRegistered: 'NOT_REGISTERED',
    registered: 'REGISTERED',
    optOut: 'OPT_OUT'
};

const FORCE_REVALIDATE = String(process.env.BULK_FORCE_REVALIDATE || '').toLowerCase() === 'true';

let workbookContext = null;

process.on('exit', () => {
    try {
        workbookContext?.save();
    } catch (error) {
        console.error('No se pudo guardar el archivo actualizado:', error.message);
    }
});

const SIGNAL_EXIT_CODES = {
    SIGINT: 130,
    SIGTERM: 143
};

function handleTermination(signal) {
    try {
        workbookContext?.save();
    } catch (error) {
        console.error('No se pudo guardar el archivo actualizado:', error.message);
    } finally {
        process.exit(SIGNAL_EXIT_CODES[signal] ?? 0);
    }
}

process.on('SIGINT', () => handleTermination('SIGINT'));
process.on('SIGTERM', () => handleTermination('SIGTERM'));

const DEFAULT_MIN_DELAY = Number.parseInt(process.env.BULK_MIN_DELAY_MS, 10) || 5000;
const VALIDATION_DELAY = Number.parseInt(process.env.BULK_VALIDATION_DELAY_MS, 10) || 2000;
const MESSAGE_TEMPLATE_ENV = process.env.BULK_MESSAGE_TEMPLATE || 'Hola {name}, este es un mensaje automatizado.';
const MESSAGE_FILE_ENV = process.env.BULK_MESSAGE_FILE;
const OPT_OUT_FILE_ENV = process.env.BULK_OPTOUT_FILE;
const DEFAULT_OPT_OUT_FILE = 'optout.txt';
const OPT_OUT_FILE_PATH = path.resolve(process.cwd(), OPT_OUT_FILE_ENV || DEFAULT_OPT_OUT_FILE);

const VENEZUELA_COUNTRY_CODE = '58';
const VENEZUELA_PREFIXES = ['412', '422', '416', '426', '414', '424'];

let messageTemplate = MESSAGE_TEMPLATE_ENV;

/**
 * Normalizes Venezuelan mobile phone numbers to the WhatsApp format (<digits>@c.us).
 * Ensures they start with country code 58 and one of the accepted mobile prefixes.
 * @param {string|number} input
 * @returns {{id: string, display: string}|null}
 */
function normalizePhoneNumber(input) {
    if (input === null || input === undefined) {
        return null;
    }

    let digits = String(input).replace(/\D/g, '');

    if (!digits) {
        return null;
    }

    if (digits.startsWith('00')) {
        digits = digits.slice(2);
    }

    digits = digits.replace(/^0+/, '');

    if (digits.startsWith(VENEZUELA_COUNTRY_CODE)) {
        digits = digits.slice(VENEZUELA_COUNTRY_CODE.length);
    }

    if (!VENEZUELA_PREFIXES.some(prefix => digits.startsWith(prefix))) {
        return null;
    }

    if (digits.length !== 10) {
        return null;
    }

    const normalized = `${VENEZUELA_COUNTRY_CODE}${digits}`;

    return {
        id: `${normalized}@c.us`,
        display: normalized
    };
}

function normalizeOptOutEntry(input) {
    const normalized = normalizePhoneNumber(input);

    if (!normalized) {
        return null;
    }

    return normalized.display;
}

function persistOptOutNumbers(filePath, numbersSet) {
    const sorted = Array.from(numbersSet).sort();
    const data = sorted.join('\n');
    const content = sorted.length > 0 ? `${data}\n` : '';

    fs.writeFileSync(filePath, content, 'utf8');
}

function loadOptOutNumbers(filePath) {
    if (!fs.existsSync(filePath)) {
        return new Set();
    }

    const rawEntries = fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const normalizedNumbers = new Set();
    let needsPersistence = false;

    for (const entry of rawEntries) {
        const normalized = normalizeOptOutEntry(entry);

        if (!normalized) {
            console.warn(`Entrada inválida en la lista de opt-out: "${entry}". Se ignorará.`);
            needsPersistence = true;
            continue;
        }

        normalizedNumbers.add(normalized);

        if (normalized !== entry) {
            needsPersistence = true;
        }
    }

    if (needsPersistence) {
        persistOptOutNumbers(filePath, normalizedNumbers);
    }

    return normalizedNumbers;
}

function applyOptOutUpdates(entries, optOutNumbers, filePath) {
    if (!entries || entries.length === 0) {
        return false;
    }

    let updated = false;

    for (const entry of entries) {
        const normalized = normalizeOptOutEntry(entry);

        if (!normalized) {
            console.warn(`No se pudo interpretar el número de opt-out "${entry}". Se ignora.`);
            continue;
        }

        if (optOutNumbers.has(normalized)) {
            continue;
        }

        optOutNumbers.add(normalized);
        console.log(`Número ${normalized} añadido a la lista de opt-out.`);
        updated = true;
    }

    if (updated) {
        persistOptOutNumbers(filePath, optOutNumbers);
    }

    return updated;
}

/**
 * Loads contacts from an Excel file.
 * @param {string} workbookPath
 */
function createWorkbookContext(workbookPath, workbook, sheetName) {
    const sheet = workbook.Sheets[sheetName];

    if (!sheet['!ref']) {
        sheet['!ref'] = 'A1';
    }

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headerRowIndex = range.s.r;
    const columnIndexes = new Map();

    for (let col = range.s.c; col <= range.e.c; col += 1) {
        const headerAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
        const cell = sheet[headerAddress];
        const headerValue = cell && cell.v !== undefined && cell.v !== null ? String(cell.v).trim() : '';

        if (headerValue) {
            columnIndexes.set(headerValue.toLowerCase(), col);
        }
    }

    let workbookDirty = false;
    const pendingUpdates = new Map();

    function ensureColumn(columnName) {
        const lower = columnName.toLowerCase();

        if (columnIndexes.has(lower)) {
            return columnIndexes.get(lower);
        }

        const newCol = range.e.c + 1;
        range.e.c = newCol;

        const headerAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: newCol });
        sheet[headerAddress] = { t: 's', v: columnName };
        sheet['!ref'] = XLSX.utils.encode_range(range);

        columnIndexes.set(lower, newCol);
        workbookDirty = true;

        return newCol;
    }

    function setCellValue(rowNumber, columnIndex, value) {
        const cellAddress = XLSX.utils.encode_cell({ r: rowNumber, c: columnIndex });

        if (value === undefined || value === null || value === '') {
            delete sheet[cellAddress];
            return;
        }

        sheet[cellAddress] = { t: 's', v: value };
    }

    function queueStatus(rowNumber, status, message, timestamp) {
        if (!rowNumber) {
            return;
        }

        pendingUpdates.set(rowNumber, {
            status,
            message: message || '',
            timestamp: timestamp || new Date().toISOString()
        });
    }

    function flushPendingUpdates() {
        if (pendingUpdates.size === 0) {
            return;
        }

        const statusColumnIndex = ensureColumn(STATUS_COLUMN);
        const messageColumnIndex = ensureColumn(STATUS_MESSAGE_COLUMN);
        const lastCheckedColumnIndex = ensureColumn(STATUS_LAST_CHECKED_COLUMN);

        for (const [rowNumber, update] of pendingUpdates.entries()) {
            const zeroBasedRow = rowNumber - 1;

            setCellValue(zeroBasedRow, statusColumnIndex, update.status);
            setCellValue(zeroBasedRow, messageColumnIndex, update.message);
            setCellValue(zeroBasedRow, lastCheckedColumnIndex, update.timestamp);
        }

        pendingUpdates.clear();
        workbookDirty = true;
    }

    function save() {
        flushPendingUpdates();

        if (!workbookDirty) {
            return;
        }

        XLSX.writeFile(workbook, workbookPath);
        workbookDirty = false;
    }

    return {
        queueStatus,
        save,
        sheet,
        range,
        getStatusColumnIndex: () => columnIndexes.get(STATUS_COLUMN.toLowerCase())
    };
}

function readContactsFromWorkbook(workbookPath, optOutNumbers) {
    const absolutePath = path.resolve(workbookPath);

    if (!fs.existsSync(absolutePath)) {
        throw new Error(`No se encontró el archivo: ${absolutePath}`);
    }

    const workbook = XLSX.readFile(absolutePath);
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
        throw new Error('El archivo Excel no contiene hojas.');
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const context = createWorkbookContext(absolutePath, workbook, firstSheetName);

    const optOutSet = optOutNumbers instanceof Set ? optOutNumbers : new Set();

    const contacts = rows
        .map((row, index) => {
            const rowNumber = (row.__rowNum__ ?? index + 1) + 1;

            const telefono = row.telefono ?? row.phone ?? row.Telefono ?? row.Phone;
            const nombre = row.nombre ?? row.name ?? row.Nombre ?? row.Name;
            const rawStatus = typeof row[STATUS_COLUMN] === 'string' ? row[STATUS_COLUMN] : row[STATUS_COLUMN]?.toString?.();
            const normalizedStatus = rawStatus ? rawStatus.trim().toUpperCase() : '';

            if (!FORCE_REVALIDATE && normalizedStatus === STATUS_VALUES.invalid) {
                console.warn(`Fila ${rowNumber}: Marcado previamente como número inválido. Se omite el contacto.`);
                return null;
            }

            if (!FORCE_REVALIDATE && normalizedStatus === STATUS_VALUES.notRegistered) {
                console.warn(`Fila ${rowNumber}: Marcado previamente como no registrado en WhatsApp. Se omite el contacto.`);
                return null;
            }

            if (normalizedStatus === STATUS_VALUES.optOut) {
                console.warn(`Fila ${rowNumber}: Marcado previamente como opt-out. Se omite el contacto.`);
                return null;
            }

            const normalized = normalizePhoneNumber(telefono);

            if (!normalized) {
                console.warn(`Fila ${rowNumber}: Número inválido u omitido. Se omite el contacto.`);
                context.queueStatus(rowNumber, STATUS_VALUES.invalid, 'Número inválido u omitido.');
                return null;
            }

            if (optOutSet.has(normalized.display)) {
                console.warn(`Fila ${rowNumber}: Número en lista de opt-out. Se omite el contacto.`);
                context.queueStatus(rowNumber, STATUS_VALUES.optOut, 'Número en lista de opt-out.');
                return null;
            }

            const trimmedName = typeof nombre === 'string' ? nombre.trim() : '';

            return {
                rowNumber,
                needsValidation: FORCE_REVALIDATE || normalizedStatus !== STATUS_VALUES.registered,
                phoneId: normalized.id,
                phoneDisplay: normalized.display,
                name: trimmedName || normalized.display
            };
        })
        .filter(Boolean);

    return { contacts, context };
}

function buildMessage(contact) {
    return messageTemplate
        .replace(/\{name\}/g, contact.name)
        .replace(/\{phone\}/g, contact.phoneDisplay);
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendBulkMessages(client, contacts, minDelayMs) {
    for (const contact of contacts) {
        const message = buildMessage(contact);

        try {
            await client.sendMessage(contact.phoneId, message);
            console.log(`Mensaje enviado a ${contact.name} (${contact.phoneDisplay})`);
        } catch (error) {
            console.error(`Error al enviar mensaje a ${contact.phoneDisplay}:`, error.message);
        }

        await delay(minDelayMs);
    }
}

async function filterRegisteredContacts(client, contacts, validationDelayMs, context) {
    const registered = [];

    for (const contact of contacts) {
        try {
            if (!contact.needsValidation) {
                registered.push(contact);
                context.queueStatus(contact.rowNumber, STATUS_VALUES.registered, 'Validación omitida (resultado previo).');
            } else {
                const numberId = await client.getNumberId(contact.phoneId);

                if (!numberId) {
                    console.warn(`El número ${contact.phoneDisplay} no está registrado en WhatsApp. Se omite.`);
                    context.queueStatus(contact.rowNumber, STATUS_VALUES.notRegistered, 'No está registrado en WhatsApp.');
                } else {
                    registered.push({ ...contact, needsValidation: false });
                    context.queueStatus(contact.rowNumber, STATUS_VALUES.registered, 'Validado en WhatsApp.');
                }
            }
        } catch (error) {
            console.error(`Error al validar ${contact.phoneDisplay}:`, error.message);
        }

        if (validationDelayMs > 0) {
            await delay(validationDelayMs);
        }
    }

    return registered;
}

function resolveMessageTemplate() {
    const candidates = [];

    if (MESSAGE_FILE_ENV) {
        candidates.push({ path: MESSAGE_FILE_ENV, isExplicit: true });
    }

    const defaultFile = path.resolve(process.cwd(), 'message.txt');
    if (!MESSAGE_FILE_ENV || path.resolve(MESSAGE_FILE_ENV) !== defaultFile) {
        candidates.push({ path: defaultFile, isExplicit: false });
    }

    for (const candidate of candidates) {
        const absolutePath = path.resolve(candidate.path);

        if (!fs.existsSync(absolutePath)) {
            if (candidate.isExplicit) {
                console.warn(`No se encontró el archivo de mensaje indicado (${absolutePath}). Se utilizará la plantilla predeterminada.`);
            }
            continue;
        }

        const content = fs.readFileSync(absolutePath, 'utf8').trim();

        if (!content) {
            console.warn(`El archivo de mensaje (${absolutePath}) está vacío. Se ignora.`);
            continue;
        }

        return { content, source: absolutePath };
    }

    return null;
}

function parseArguments(argv) {
    const positional = [];
    const optOutEntries = [];

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === '--optout') {
            const value = argv[index + 1];

            if (value === undefined) {
                throw new Error('Falta un número después de --optout.');
            }

            optOutEntries.push(value);
            index += 1;
            continue;
        }

        if (argument.startsWith('--optout=')) {
            const value = argument.slice('--optout='.length);

            if (!value) {
                throw new Error('Falta un número después de --optout=.');
            }

            optOutEntries.push(value);
            continue;
        }

        positional.push(argument);
    }

    return { positional, optOutEntries };
}

async function main() {
    let parsedArguments;

    try {
        parsedArguments = parseArguments(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        console.error('Uso: node bulk-sender.js <ruta_excel> [delay_ms] [--optout <numero> ...]');
        process.exit(1);
    }

    const { positional, optOutEntries } = parsedArguments;
    const [excelPath, minDelayArg, ...extraPositionals] = positional;

    if (!excelPath) {
        console.error('Uso: node bulk-sender.js <ruta_excel> [delay_ms] [--optout <numero> ...]');
        process.exit(1);
    }

    if (extraPositionals.length > 0) {
        console.warn(`Argumentos posicionales adicionales ignorados: ${extraPositionals.join(', ')}`);
    }

    const minDelayMs = Number.parseInt(minDelayArg, 10) || DEFAULT_MIN_DELAY;

    const optOutNumbers = loadOptOutNumbers(OPT_OUT_FILE_PATH);
    const optOutUpdated = applyOptOutUpdates(optOutEntries, optOutNumbers, OPT_OUT_FILE_PATH);

    if (optOutNumbers.size > 0) {
        console.log(`Lista de opt-out cargada (${optOutNumbers.size} números) desde ${OPT_OUT_FILE_PATH}.`);
    }

    if (optOutEntries.length > 0 && !optOutUpdated) {
        console.warn('No se añadieron números válidos a la lista de opt-out.');
    }

    const templateFromFile = resolveMessageTemplate();

    if (templateFromFile) {
        messageTemplate = templateFromFile.content;
        console.log(`Mensaje cargado desde ${templateFromFile.source}`);
    } else {
        console.log('Usando plantilla de mensaje predeterminada.');
    }

    console.log(`Leyendo contactos desde ${excelPath}...`);
    const { contacts, context } = readContactsFromWorkbook(excelPath, optOutNumbers);
    workbookContext = context;
    console.log(`Contactos válidos: ${contacts.length}`);

    if (FORCE_REVALIDATE) {
        console.log('La variable BULK_FORCE_REVALIDATE está activa. Todos los números serán revalidados en esta ejecución.');
    }

    if (contacts.length === 0) {
        console.warn('No hay contactos válidos para procesar.');
        context.save();
        process.exit(0);
    }

    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: false
        }
    });

    client.on('qr', qr => {
        console.log('Escanea este código QR para vincular tu sesión:');
        console.log(qr);
    });

    client.on('ready', async () => {
        console.log('Cliente listo. Verificando números en WhatsApp...');
        const registeredContacts = await filterRegisteredContacts(client, contacts, VALIDATION_DELAY, context);

        console.log(`Contactos activos en WhatsApp: ${registeredContacts.length}`);

        if (registeredContacts.length === 0) {
            console.warn('No hay contactos activos para enviar mensajes.');
            context.save();
            await client.destroy();
            return;
        }

        console.log('Iniciando envío masivo...');
        await sendBulkMessages(client, registeredContacts, minDelayMs);
        console.log('Proceso finalizado. Puedes cerrar la aplicación.');
        context.save();
        await client.destroy();
    });

    client.on('auth_failure', msg => {
        console.error('Error de autenticación:', msg);
        context.save();
    });

    client.initialize();
}

main().catch(error => {
    console.error('Error inesperado:', error);
    process.exit(1);
});

