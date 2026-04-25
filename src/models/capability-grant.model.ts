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
    // on-disk name.
    tableName: 'CapabilityGrants',
    timestamps: false
});
