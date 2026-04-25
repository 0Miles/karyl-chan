import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

/**
 * One row per Discord DM channel the bot has observed. `id` is the
 * channel snowflake; `recipientId` is the user on the other end —
 * one channel per recipient is a Discord invariant, enforced here
 * with a unique index so an out-of-band write can't smuggle in a
 * duplicate.
 *
 * `lastMessageAt` is INTENTIONALLY stored as an ISO 8601 string
 * (`Date.prototype.toISOString()`). ISO 8601 sorts lexicographically
 * the same way it sorts chronologically, so `ORDER BY lastMessageAt`
 * works without DATE type semantics. Anything that writes this column
 * MUST use `.toISOString()` — non-ISO formats would silently break the
 * sidebar order. Switching to DataTypes.DATE would change the runtime
 * read shape (Date vs string) and ripple through dm-inbox.service.ts,
 * which we deliberately avoid here.
 */
export const DmChannel = sequelize.define('DmChannel', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    recipientId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    recipientUsername: {
        type: DataTypes.STRING,
        allowNull: false
    },
    recipientGlobalName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    recipientAvatarUrl: {
        type: DataTypes.STRING,
        allowNull: true
    },
    lastMessageAt: {
        type: DataTypes.STRING,
        allowNull: true
    },
    lastMessageId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    lastMessagePreview: {
        type: DataTypes.STRING(160),
        allowNull: true
    }
}, {
    tableName: 'DmChannels',
    timestamps: false,
    indexes: [
        { name: 'dm_channels_recipient_id_unique', fields: ['recipientId'], unique: true }
    ]
});
