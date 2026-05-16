import { describe, it, expect } from "vitest";
import {
  ApplicationCommandOptionType,
  type ApplicationCommandSubCommandData,
  type ApplicationCommandChannelOptionData,
  type ApplicationCommandStringOptionData,
} from "discord.js";
import {
  manifestOptionToData,
  ManifestCommandError,
} from "../src/modules/plugin-system/plugin-command-registry.service.js";

/**
 * `manifestOptionToData` is the pure mapping that turns a plugin
 * manifest option (loose JSON shape) into a discord.js
 * ApplicationCommandOptionData. Every code path through the bot's
 * plugin command registration eventually runs through this, so a
 * regression here silently breaks command registration for every
 * plugin author.
 */
describe("manifestOptionToData", () => {
  it("maps a simple string option", () => {
    const result = manifestOptionToData({
      type: "string",
      name: "query",
      description: "What to search for",
      required: true,
    }) as ApplicationCommandStringOptionData;
    expect(result.type).toBe(ApplicationCommandOptionType.String);
    expect(result.name).toBe("query");
    expect(result.description).toBe("What to search for");
    expect(result.required).toBe(true);
  });

  it("falls back to name as description when description is omitted", () => {
    const result = manifestOptionToData({ type: "boolean", name: "verbose" });
    expect(result.description).toBe("verbose");
  });

  it("defaults required to false when omitted", () => {
    const result = manifestOptionToData({
      type: "string",
      name: "tag",
    }) as ApplicationCommandStringOptionData;
    expect(result.required).toBe(false);
  });

  it("throws ManifestCommandError for an unknown option type", () => {
    expect(() =>
      manifestOptionToData({ type: "warp_drive", name: "x" }),
    ).toThrow(ManifestCommandError);
  });

  it("attaches channelTypes only on channel options", () => {
    const result = manifestOptionToData({
      type: "channel",
      name: "target",
      channel_types: ["GUILD_TEXT", "GUILD_VOICE"],
    }) as ApplicationCommandChannelOptionData;
    expect(result.channelTypes).toEqual([0, 2]);
  });

  it("ignores channel_types for non-channel options", () => {
    const result = manifestOptionToData({
      type: "string",
      name: "x",
      channel_types: ["GUILD_TEXT"],
    } as never);
    expect((result as unknown as Record<string, unknown>).channelTypes).toBeUndefined();
  });

  it("filters unrecognised channel_types out instead of throwing", () => {
    // The mapping deliberately filters (vs. throws) so a manifest
    // referencing a channel type the bot doesn't know yet still
    // registers — Discord just won't allow that channel kind.
    const result = manifestOptionToData({
      type: "channel",
      name: "where",
      channel_types: ["GUILD_TEXT", "BOGUS_TYPE"],
    }) as ApplicationCommandChannelOptionData;
    expect(result.channelTypes).toEqual([0]);
  });

  it("passes choices through verbatim for string/number options", () => {
    const result = manifestOptionToData({
      type: "string",
      name: "color",
      choices: [
        { name: "Red", value: "r" },
        { name: "Blue", value: "b" },
      ],
    }) as ApplicationCommandStringOptionData;
    expect(result.choices).toEqual([
      { name: "Red", value: "r" },
      { name: "Blue", value: "b" },
    ]);
  });

  it("recurses into sub_command options and drops `required`", () => {
    const result = manifestOptionToData({
      type: "sub_command",
      name: "set",
      options: [
        { type: "string", name: "key", required: true },
        { type: "string", name: "value", required: true },
      ],
    }) as ApplicationCommandSubCommandData;
    expect(result.type).toBe(ApplicationCommandOptionType.Subcommand);
    expect(Array.isArray(result.options)).toBe(true);
    expect(result.options?.length).toBe(2);
    // Subcommands can't be "required" at the top of their parent —
    // it's the choice that's selected, not a field that gets filled.
    expect((result as unknown as Record<string, unknown>).required).toBeUndefined();
  });

  it("does not recurse into flat option types even when options[] is present", () => {
    // A "string" option can't have nested options. The mapping
    // ignores the field rather than passing it through (which would
    // produce a Discord-side validation error).
    const result = manifestOptionToData({
      type: "string",
      name: "x",
      options: [{ type: "string", name: "nested" }],
    } as never);
    expect((result as unknown as Record<string, unknown>).options).toBeUndefined();
  });
});
