// App shell: the frame every page renders inside (mounted once in app/layout.tsx).
export { AppShell } from "@/components/shell/app-shell"
export { PageContainer, type PageContainerProps } from "@/components/shell/page-container"
export { openCommandPalette, openSettings, OPEN_COMMAND_PALETTE_EVENT, OPEN_SETTINGS_EVENT } from "@/components/shell/shell-events"
export { NAV_GROUPS, NAV_ITEMS, NEW_CHAT_HREF, NEW_DEPLOYMENT_HREF, activeNavItem, breadcrumbFor } from "@/components/shell/nav-config"
