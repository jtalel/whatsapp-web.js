const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const { Client, LocalAuth } = require('./index');

const DEFAULT_MIN_DELAY = Number.parseInt(process.env.BULK_MIN_DELAY_MS, 10) || 5000;
const DEFAULT_COUNTRY_CODE = process.env.BULK_DEFAULT_COUNTRY_CODE || '';
const MESSAGE_TEMPLATE = process.env.BULK_MESSAGE_TEMPLATE || 'Hola {name}, este es un mensaje automatizado.';

/**
 * Normalizes phone numbers to the WhatsApp format (<digits>@c.us).
 * Optionally prefixes a default country code when it is missing.
 * @param {string|number} input
 * @param {string} defaultCountryCode
 * @returns {{id: string, display: string}|null}
 */
function normalizePhoneNumber(input, defaultCountryCode = '') {
    if (input === null || input === undefined) {
        return null;
    }

    let digits = String(input).replace(/[^\d+]/g, '');

    if (!digits) {
        return null;
    }

    if (digits.startsWith('+')) {
        digits = digits.slice(1);
    }

    if (digits.startsWith('00')) {
        digits = digits.slice(2);
    }

    if (defaultCountryCode && !digits.startsWith(defaultCountryCode)) {
        digits = `${defaultCountryCode}${digits.replace(/^0+/, '')}`;
    }

    if (digits.length < 8) {
        return null;
    }

    return {
        id: `${digits}@c.us`,
        display: digits
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

            const normalized = normalizePhoneNumber(telefono, DEFAULT_COUNTRY_CODE);

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
    return MESSAGE_TEMPLATE
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

async function main() {
    const [,, excelPath, minDelayArg] = process.argv;

    if (!excelPath) {
        console.error('Uso: node bulk-sender.js <ruta_excel> [delay_ms]');
        process.exit(1);
    }

    const minDelayMs = Number.parseInt(minDelayArg, 10) || DEFAULT_MIN_DELAY;

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
        console.log('Cliente listo. Iniciando envío masivo...');
        await sendBulkMessages(client, contacts, minDelayMs);
        console.log('Proceso finalizado. Puedes cerrar la aplicación.');
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

