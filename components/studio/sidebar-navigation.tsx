"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { studioIcons } from "./icons";

type NavigationItem = {
  href: string;
  route: string;
  label: string;
  icon: keyof typeof studioIcons;
};

function routeIsActive(pathname: string, route: string) {
  if (route === "/studio") return pathname === route;
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function StudioPrimaryNavigation({ items }: { items: NavigationItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Ensemblis primary navigation">
      {items.map(({ href, route, label, icon }) => {
        const Icon = studioIcons[icon];
        const active = routeIsActive(pathname, route);
        return (
          <Link
            href={href}
            key={route}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
            aria-label={label}
            title={label}
          >
            <Icon aria-hidden />
            <span className="studio-nav-text">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function StudioAdvancedNavigation({ item }: { item: NavigationItem }) {
  const pathname = usePathname();
  const active = routeIsActive(pathname, item.route);
  const Icon = studioIcons[item.icon];

  return (
    <Link
      href={item.href}
      className={active ? "is-active" : undefined}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      title={item.label}
    >
      <Icon aria-hidden />
      <span className="studio-nav-text">{item.label}</span>
    </Link>
  );
}
