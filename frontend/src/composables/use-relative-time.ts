import { useI18n } from 'vue-i18n';

/**
 * Shared composable for i18n-aware relative time formatting.
 *
 * Provides two functions:
 *   - relativeJoin(iso): "today" / "yesterday" / "3d ago" / "2mo ago" / "1y ago"
 *     (used in GuildsListCard)
 *   - relativeTime(iso | null): "30s ago" / "5m ago" / "2h ago" / "1d ago" / "Never"
 *     (used in AdminLoginCard, BotEventsCard, RecentActivity)
 */
export function useRelativeTime() {
    const { t } = useI18n();

    function relativeJoin(iso: string | null): string {
        if (!iso) return '—';
        const diff = Date.now() - new Date(iso).getTime();
        const days = Math.floor(diff / 86_400_000);
        if (days < 1) return t('dashboard.relTime.today');
        if (days === 1) return t('dashboard.relTime.yesterday');
        if (days < 30) return t('dashboard.relTime.daysAgo', { n: days });
        const months = Math.floor(days / 30);
        if (months < 12) return t('dashboard.relTime.monthsAgo', { n: months });
        return t('dashboard.relTime.yearsAgo', { n: Math.floor(months / 12) });
    }

    function relativeTime(iso: string | null): string {
        if (!iso) return t('dashboard.relTime.never');
        const diff = Date.now() - new Date(iso).getTime();
        const secs = Math.floor(diff / 1000);
        if (secs < 60) return t('dashboard.relTime.secsAgo', { n: secs });
        const mins = Math.floor(secs / 60);
        if (mins < 60) return t('dashboard.relTime.minsAgo', { n: mins });
        const hours = Math.floor(mins / 60);
        if (hours < 24) return t('dashboard.relTime.hoursAgo', { n: hours });
        return t('dashboard.relTime.daysAgo', { n: Math.floor(hours / 24) });
    }

    return { relativeJoin, relativeTime };
}
