import { Sequelize } from 'sequelize';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DB_PATH = resolve(dirname(__dirname), '../data/database.sqlite');

export const sequelize = new Sequelize({
    storage: process.env.SQLITE_DB_PATH || DEFAULT_DB_PATH,
    dialect: 'sqlite',
    logging: false
});

