---
name: wix-app-management
description: "Wix business solution management recipes — REST API operations for configuring and managing Wix business solutions. Routes to: stores, bookings, payments, CMS, contacts, events, forms, media, platform, pricing-plans, restaurants, rich-content, sites, blog."
compatibility: Requires Wix REST API access (API key or OAuth).
---

# Wix Business Solution Management Recipes

Index of all Wix business solution management recipes. Each business solution has its own index in a sub-skill with detailed REST API recipes for site setup, entity management, and backend integrations.

## ⚠️ MANDATORY WORKFLOW

1. **Identify** which business solution(s) the user needs from the router below
2. **Read** the corresponding sub-skill `SKILL.md` file
3. **Follow** that sub-skill's workflow to find and apply the right recipe(s)
4. **If multiple solutions are needed**, read each sub-skill sequentially

**🛑 STOP:** Never implement a recipe without first reading its reference file.

---

## Quick Router

| User wants to...       | Route to                  |
| ---------------------- | ------------------------- |
| Create/manage products | [Stores](stores/SKILL.md) |

---

## Business Solutions Overview

### Stores

Wix Stores lets site owners create and manage an online store for physical and digital products. Each site supports either Catalog V1 or V3 (not both) — always check the site's catalog version first using the Catalog Versioning API.
