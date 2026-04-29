import { Message } from "discord.js";
import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

export const TodoMessage = sequelize.define(
  "TodoMessage",
  {
    messageId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    channelId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    guildId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    // `createdAt` is set explicitly from the Discord message timestamp
    // (see addTodoMessage below). The original deployment relied on the
    // Sequelize default (`timestamps: true`) which kept that field
    // ORM-managed AND added an `updatedAt` column NOT NULL. Switching to
    // `timestamps: false` made INSERTs against legacy DBs fail on the
    // missing updatedAt, so we keep the default and just let Sequelize
    // also touch updatedAt — harmless because nothing reads it.
    createdAt: DataTypes.DATE,
  },
  {
    tableName: "TodoMessages",
  },
);

export const addTodoMessage = async (message: Message) => {
  await TodoMessage.findOrCreate({
    where: {
      messageId: message.id,
      channelId: message.channelId,
      guildId: message.guildId,
    },
    defaults: {
      messageId: message.id,
      channelId: message.channelId,
      guildId: message.guildId,
      createdAt: message.createdAt,
    },
  });
};

export const removeTodoMessage = async (
  guildId: string,
  channelId: string,
  messageId: string,
) => {
  await TodoMessage.destroy({
    where: {
      channelId: channelId,
      messageId: messageId,
      guildId: guildId,
    },
  });
};

export const findChannelTodoMessages = async (
  guildId: string,
  channelId: string,
) => {
  return await TodoMessage.findAll({
    where: {
      channelId: channelId,
      guildId: guildId,
    },
    order: [["createdAt", "ASC"]],
  });
};
