/**
 * DM proactive feature manifest. Each entry pairs a "the bot does
 * something on the admin's behalf" action (rather than the admin
 * typing free-form text) with the popover-menu metadata used to
 * present it. Adding a new feature to `registry.ts` automatically
 * surfaces it in the composer's proactive-features menu.
 *
 * Action names are kebab-case and match the backend's
 * /api/dm/channels/:channelId/proactive/:action path segment.
 */
export interface DmProactiveFeature {
    /** URL-segment identifier; mirrors the backend action name. */
    name: string;
    /** i18n key for the menu label. */
    labelKey: string;
    /** Iconify icon shown next to the label. */
    icon: string;
    /**
     * Optional i18n key for a one-line subtitle under the label —
     * used by features whose name alone doesn't make it obvious what
     * pressing the entry will do.
     */
    descriptionKey?: string;
}
