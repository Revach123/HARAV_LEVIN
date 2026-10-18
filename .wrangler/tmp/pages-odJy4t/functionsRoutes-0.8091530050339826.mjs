import { onRequestGet as __api_permit_docs__id__file_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/permit-docs/[id]/file.js"
import { onRequestDelete as __api_businesses__id__js_onRequestDelete } from "/home/user/HARAV_LEVIN/functions/api/businesses/[id].js"
import { onRequestPut as __api_businesses__id__js_onRequestPut } from "/home/user/HARAV_LEVIN/functions/api/businesses/[id].js"
import { onRequestGet as __api_permit_docs_public__id__js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/permit-docs-public/[id].js"
import { onRequestDelete as __api_permit_docs__id__js_onRequestDelete } from "/home/user/HARAV_LEVIN/functions/api/permit-docs/[id].js"
import { onRequestGet as __api_permit_docs__id__js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/permit-docs/[id].js"
import { onRequestPut as __api_permit_docs__id__js_onRequestPut } from "/home/user/HARAV_LEVIN/functions/api/permit-docs/[id].js"
import { onRequestDelete as __api_permit_ext__id__js_onRequestDelete } from "/home/user/HARAV_LEVIN/functions/api/permit-ext/[id].js"
import { onRequestPut as __api_permit_ext__id__js_onRequestPut } from "/home/user/HARAV_LEVIN/functions/api/permit-ext/[id].js"
import { onRequestGet as __api_approved_bonds_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/approved-bonds.js"
import { onRequestPut as __api_approved_bonds_js_onRequestPut } from "/home/user/HARAV_LEVIN/functions/api/approved-bonds.js"
import { onRequestGet as __api_businesses_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/businesses.js"
import { onRequestPost as __api_businesses_js_onRequestPost } from "/home/user/HARAV_LEVIN/functions/api/businesses.js"
import { onRequestPost as __api_change_password_js_onRequestPost } from "/home/user/HARAV_LEVIN/functions/api/change-password.js"
import { onRequestGet as __api_company_bonds_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/company-bonds.js"
import { onRequestGet as __api_debug_tase_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/debug-tase.js"
import { onRequestGet as __api_lists_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/lists.js"
import { onRequestOptions as __api_lists_js_onRequestOptions } from "/home/user/HARAV_LEVIN/functions/api/lists.js"
import { onRequestGet as __api_login_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/login.js"
import { onRequestPost as __api_login_js_onRequestPost } from "/home/user/HARAV_LEVIN/functions/api/login.js"
import { onRequestGet as __api_lookup_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/lookup.js"
import { onRequestGet as __api_permit_docs_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/permit-docs.js"
import { onRequestPost as __api_permit_docs_js_onRequestPost } from "/home/user/HARAV_LEVIN/functions/api/permit-docs.js"
import { onRequestGet as __api_permit_docs_public_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/permit-docs-public.js"
import { onRequestGet as __api_permit_ext_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/permit-ext.js"
import { onRequestPost as __api_permit_ext_js_onRequestPost } from "/home/user/HARAV_LEVIN/functions/api/permit-ext.js"
import { onRequestGet as __api_permit_review_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/permit-review.js"
import { onRequestPut as __api_permit_review_js_onRequestPut } from "/home/user/HARAV_LEVIN/functions/api/permit-review.js"
import { onRequestGet as __api_registry_name_search_js_onRequestGet } from "/home/user/HARAV_LEVIN/functions/api/registry-name-search.js"
import { onRequestPost as __api_sync_tase_js_onRequestPost } from "/home/user/HARAV_LEVIN/functions/api/sync-tase.js"
import { onRequest as __api_ivr_company_js_onRequest } from "/home/user/HARAV_LEVIN/functions/api/ivr-company.js"
import { onRequest as __api_voice_search_js_onRequest } from "/home/user/HARAV_LEVIN/functions/api/voice-search.js"
import { onRequest as __api__middleware_js_onRequest } from "/home/user/HARAV_LEVIN/functions/api/_middleware.js"

export const routes = [
    {
      routePath: "/api/permit-docs/:id/file",
      mountPath: "/api/permit-docs/:id",
      method: "GET",
      middlewares: [],
      modules: [__api_permit_docs__id__file_js_onRequestGet],
    },
  {
      routePath: "/api/businesses/:id",
      mountPath: "/api/businesses",
      method: "DELETE",
      middlewares: [],
      modules: [__api_businesses__id__js_onRequestDelete],
    },
  {
      routePath: "/api/businesses/:id",
      mountPath: "/api/businesses",
      method: "PUT",
      middlewares: [],
      modules: [__api_businesses__id__js_onRequestPut],
    },
  {
      routePath: "/api/permit-docs-public/:id",
      mountPath: "/api/permit-docs-public",
      method: "GET",
      middlewares: [],
      modules: [__api_permit_docs_public__id__js_onRequestGet],
    },
  {
      routePath: "/api/permit-docs/:id",
      mountPath: "/api/permit-docs",
      method: "DELETE",
      middlewares: [],
      modules: [__api_permit_docs__id__js_onRequestDelete],
    },
  {
      routePath: "/api/permit-docs/:id",
      mountPath: "/api/permit-docs",
      method: "GET",
      middlewares: [],
      modules: [__api_permit_docs__id__js_onRequestGet],
    },
  {
      routePath: "/api/permit-docs/:id",
      mountPath: "/api/permit-docs",
      method: "PUT",
      middlewares: [],
      modules: [__api_permit_docs__id__js_onRequestPut],
    },
  {
      routePath: "/api/permit-ext/:id",
      mountPath: "/api/permit-ext",
      method: "DELETE",
      middlewares: [],
      modules: [__api_permit_ext__id__js_onRequestDelete],
    },
  {
      routePath: "/api/permit-ext/:id",
      mountPath: "/api/permit-ext",
      method: "PUT",
      middlewares: [],
      modules: [__api_permit_ext__id__js_onRequestPut],
    },
  {
      routePath: "/api/approved-bonds",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_approved_bonds_js_onRequestGet],
    },
  {
      routePath: "/api/approved-bonds",
      mountPath: "/api",
      method: "PUT",
      middlewares: [],
      modules: [__api_approved_bonds_js_onRequestPut],
    },
  {
      routePath: "/api/businesses",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_businesses_js_onRequestGet],
    },
  {
      routePath: "/api/businesses",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_businesses_js_onRequestPost],
    },
  {
      routePath: "/api/change-password",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_change_password_js_onRequestPost],
    },
  {
      routePath: "/api/company-bonds",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_company_bonds_js_onRequestGet],
    },
  {
      routePath: "/api/debug-tase",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_debug_tase_js_onRequestGet],
    },
  {
      routePath: "/api/lists",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_lists_js_onRequestGet],
    },
  {
      routePath: "/api/lists",
      mountPath: "/api",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_lists_js_onRequestOptions],
    },
  {
      routePath: "/api/login",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_login_js_onRequestGet],
    },
  {
      routePath: "/api/login",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_login_js_onRequestPost],
    },
  {
      routePath: "/api/lookup",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_lookup_js_onRequestGet],
    },
  {
      routePath: "/api/permit-docs",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_permit_docs_js_onRequestGet],
    },
  {
      routePath: "/api/permit-docs",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_permit_docs_js_onRequestPost],
    },
  {
      routePath: "/api/permit-docs-public",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_permit_docs_public_js_onRequestGet],
    },
  {
      routePath: "/api/permit-ext",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_permit_ext_js_onRequestGet],
    },
  {
      routePath: "/api/permit-ext",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_permit_ext_js_onRequestPost],
    },
  {
      routePath: "/api/permit-review",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_permit_review_js_onRequestGet],
    },
  {
      routePath: "/api/permit-review",
      mountPath: "/api",
      method: "PUT",
      middlewares: [],
      modules: [__api_permit_review_js_onRequestPut],
    },
  {
      routePath: "/api/registry-name-search",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_registry_name_search_js_onRequestGet],
    },
  {
      routePath: "/api/sync-tase",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_sync_tase_js_onRequestPost],
    },
  {
      routePath: "/api/ivr-company",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_ivr_company_js_onRequest],
    },
  {
      routePath: "/api/voice-search",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_voice_search_js_onRequest],
    },
  {
      routePath: "/api",
      mountPath: "/api",
      method: "",
      middlewares: [__api__middleware_js_onRequest],
      modules: [],
    },
  ]