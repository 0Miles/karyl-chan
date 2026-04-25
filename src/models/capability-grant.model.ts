import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const CapabilityGrant = sequelize.define('CapabilityGrant', {
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    capability: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    roleId: {
        type: DataTypes.STRING,
        primaryKey: true
    }
}, {
    // Explicit tableName so behaviour doesn't drift if Sequelize ever
    // changes its default pluralization. Matches the long-standing
    // on-disk name. Default `timestamps: true` is intentionally kept —
    // earlier deployments created the table with NOT NULL
    // createdAt/updatedAt and disabling the timestamps would break
    // INSERTs against existing DBs.
    tableName: 'CapabilityGrants'
});
