// @generated-source wix-headless-replatform
import { autoBindInteractions } from "./rp-interactions.mjs";

const start = () => autoBindInteractions(document);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
