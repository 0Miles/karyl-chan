import { Op } from 'sequelize';
import { RefreshToken } from './models/refresh-token.model.js';
import type { RefreshStoreAdapter } from './auth-store.service.js';

export const sequelizeRefreshStore: RefreshStoreAdapter = {
    async load() {
        const rows = await RefreshToken.findAll();
        return rows.map(row => ({
            hash: row.getDataValue('hash') as string,
            ownerId: row.getDataValue('ownerId') as string,
            expiresAt: Number(row.getDataValue('expiresAt'))
        }));
    },

    async put(record) {
        await RefreshToken.upsert({
            hash: record.hash,
            ownerId: record.ownerId,
            expiresAt: record.expiresAt
        });
    },

    async delete(hash) {
        await RefreshToken.destroy({ where: { hash } });
    },

    async deleteByOwner(ownerId) {
        await RefreshToken.destroy({ where: { ownerId } });
    },

    async deleteExpired(now) {
        await RefreshToken.destroy({ where: { expiresAt: { [Op.lte]: now } } });
    }
};
