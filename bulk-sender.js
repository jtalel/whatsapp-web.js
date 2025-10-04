const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const { Client, LocalAuth } = require('./index');

const DEFAULT_MIN_DELAY = Number.parseInt(process.env.BULK_MIN_DELAY_MS, 10) || 5000;
const VALIDATION_DELAY = Number.parseInt(process.env.BULK_VALIDATION_DELAY_MS, 10) || 2000;
const MESSAGE_TEMPLATE_ENV = process.env.BULK_MESSAGE_TEMPLATE || 'Hola {name}, este es un mensaje automatizado.';
const MESSAGE_FILE_ENV = process.env.BULK_MESSAGE_FILE;

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

/**
 * Loads contacts from an Excel file.
 * @param {string} workbookPath
 */
function readContactsFromWorkbook(workbookPath) {
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

    return rows
        .map((row, index) => {
            const telefono = row.telefono ?? row.phone ?? row.Telefono ?? row.Phone;
            const nombre = row.nombre ?? row.name ?? row.Nombre ?? row.Name;

            const normalized = normalizePhoneNumber(telefono);

            if (!normalized) {
                console.warn(`Fila ${index + 2}: Número inválido u omitido. Se omite el contacto.`);
                return null;
            }

            const trimmedName = typeof nombre === 'string' ? nombre.trim() : '';

            return {
                phoneId: normalized.id,
                phoneDisplay: normalized.display,
                name: trimmedName || normalized.display
            };
        })
        .filter(Boolean);
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

async function filterRegisteredContacts(client, contacts, validationDelayMs) {
    const registered = [];

    for (const contact of contacts) {
        try {
            const numberId = await client.getNumberId(contact.phoneId);

            if (!numberId) {
                console.warn(`El número ${contact.phoneDisplay} no está registrado en WhatsApp. Se omite.`);
            } else {
                registered.push(contact);
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

async function main() {
    const [,, excelPath, minDelayArg] = process.argv;

    if (!excelPath) {
        console.error('Uso: node bulk-sender.js <ruta_excel> [delay_ms]');
        process.exit(1);
    }

    const minDelayMs = Number.parseInt(minDelayArg, 10) || DEFAULT_MIN_DELAY;

    const templateFromFile = resolveMessageTemplate();

    if (templateFromFile) {
        messageTemplate = templateFromFile.content;
        console.log(`Mensaje cargado desde ${templateFromFile.source}`);
    } else {
        console.log('Usando plantilla de mensaje predeterminada.');
    }

    console.log(`Leyendo contactos desde ${excelPath}...`);
    const contacts = readContactsFromWorkbook(excelPath);
    console.log(`Contactos válidos: ${contacts.length}`);

    if (contacts.length === 0) {
        console.warn('No hay contactos válidos para procesar.');
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
        const registeredContacts = await filterRegisteredContacts(client, contacts, VALIDATION_DELAY);

        console.log(`Contactos activos en WhatsApp: ${registeredContacts.length}`);

        if (registeredContacts.length === 0) {
            console.warn('No hay contactos activos para enviar mensajes.');
            await client.destroy();
            return;
        }

        console.log('Iniciando envío masivo...');
        await sendBulkMessages(client, registeredContacts, minDelayMs);
        console.log('Proceso finalizado. Puedes cerrar la aplicación.');
        await client.destroy();
    });

    client.on('auth_failure', msg => {
        console.error('Error de autenticación:', msg);
    });

    client.initialize();
}

main().catch(error => {
    console.error('Error inesperado:', error);
    process.exit(1);
});

