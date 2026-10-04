// The account page's one island: the gate and the view in a single React tree. Mount it from the
// Astro page as <AccountPage client:only="react" />. Do NOT write
// <RequireAuth client:only="react"><AccountView /></RequireAuth> in an .astro file: a framework
// component's children written in Astro are rendered once on the server as static HTML, so the
// view never hydrates and stays on its loading placeholder. Any gated surface you build follows
// the same shape — one React component that nests RequireAuth around the view.
import RequireAuth from "./RequireAuth";
import AccountView from "./AccountView";

export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountView />
    </RequireAuth>
  );
}
