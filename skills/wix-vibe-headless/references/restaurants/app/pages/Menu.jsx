// Menu page — the restaurant's main render surface. Loads the assembled getFullMenu() tree once,
// renders it via MenuList, and opens ItemDialog for a tapped dish (add-to-order lives there).
// Empty state when there are no menus. Token-styled; re-skin via theme.css.
import { useEffect, useState } from "react";
import { getFullMenu } from "@/rest/wix-restaurants-menu";
import MenuList from "@/components/MenuList";
import ItemDialog from "@/components/ItemDialog";

export default function Menu() {
  const [menus, setMenus] = useState(null);
  const [active, setActive] = useState(null);   // { item, menuId, sectionId }

  useEffect(() => { getFullMenu().then(({ menus }) => setMenus(menus)); }, []);

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Menu</h1>
      {menus === null
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <MenuList menus={menus} onOpenItem={(item, ctx) => setActive({ item, ...ctx })}
            empty="No menu yet — add one from your Wix dashboard." />}
      {active && (
        <ItemDialog item={active.item} menuId={active.menuId} sectionId={active.sectionId}
          onClose={() => setActive(null)} />
      )}
    </main>
  );
}
