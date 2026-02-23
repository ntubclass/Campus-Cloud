import {
  ClipboardCheck,
  FileText,
  Home,
  Monitor,
  ServerCog,
  Users,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { SidebarAppearance } from "@/components/Common/Appearance"
import { SidebarLanguageSwitcher } from "@/components/Common/LanguageSwitcher"
import { Logo } from "@/components/Common/Logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import { type Item, Main } from "./Main"
import { User } from "./User"

export function AppSidebar() {
  const { user: currentUser } = useAuth()
  const { t } = useTranslation("navigation")

  const baseItems: Item[] = [
    { icon: Home, title: t("sidebar.dashboard"), path: "/" },
    { icon: ServerCog, title: t("sidebar.myResources"), path: "/my-resources" },
    { icon: FileText, title: t("sidebar.applications"), path: "/applications" },
  ]

  const adminItems: Item[] = [
    { icon: Home, title: t("sidebar.dashboard"), path: "/" },
    { icon: ServerCog, title: t("sidebar.myResources"), path: "/my-resources" },
    { icon: Monitor, title: t("sidebar.resources"), path: "/resources" },
    { icon: ClipboardCheck, title: t("sidebar.approvals"), path: "/approvals" },
    { icon: Users, title: t("sidebar.admin"), path: "/admin" },
  ]

  const items = currentUser?.is_superuser ? adminItems : baseItems

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Logo variant="responsive" />
      </SidebarHeader>
      <SidebarContent>
        <Main items={items} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarLanguageSwitcher />
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
