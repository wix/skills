// Renders the assembled getFullMenu() tree: menus → sections → item cards, with the empty state.
// This is the menu render surface's body (the Menu page is a thin wrapper). Ordered already by
// the helper (sectionIds / itemIds). Token-styled; re-skin via theme.css. Each card's onOpen gets
// the item plus the menuId/sectionId it was shown under — ordering needs both.
import MenuItemCard from "./MenuItemCard";

function imageUrl(img) {
  const url = img?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

export default function MenuList({ menus, onOpenItem, empty = "No menu yet — add one from your Wix dashboard." }) {
  if (!menus?.length) {
    return <p style={{ color: "var(--color-muted)", padding: "var(--space)", textAlign: "center" }}>{empty}</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(var(--space) * 2)" }}>
      {menus.map((menu) => (
        <section key={menu.id}>
          <h2 style={{ fontFamily: "var(--font-display)", margin: "0 0 4px" }}>{menu.name}</h2>
          {menu.description && (
            <p style={{ color: "var(--color-muted)", margin: "0 0 var(--space)" }}>{menu.description}</p>
          )}
          {menu.sections.map((section) => (
            <div key={section.id} style={{ marginBottom: "calc(var(--space) * 1.5)" }}>
              <h3 style={{ fontFamily: "var(--font-display)", margin: "0 0 var(--space)" }}>{section.name}</h3>
              {imageUrl(section.image) && (
                <img src={imageUrl(section.image)} alt={section.name} loading="lazy"
                  style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: "var(--radius)", marginBottom: "var(--space)" }} />
              )}
              <div style={{
                display: "grid", gap: "var(--space)",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              }}>
                {section.items.map((item) => (
                  <MenuItemCard key={item.id} item={item}
                    onOpen={() => onOpenItem?.(item, { menuId: menu.id, sectionId: section.id })} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
