import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RAIL_PREF_KEY,
  TABS,
  activeTab,
  isRailToggleKey,
  railDefaultCollapsed,
  railItems,
  readRailPref,
  selectedFacility,
} from "./railModel.ts";

const row = (over = {}) => ({
  facilityId: "F7",
  borrower: "Dokusign Inc",
  industry: null,
  termsVersion: 1,
  hasApprovedTerms: true,
  ours: 1.12,
  theirs: 1.3,
  required: 1.25,
  status: "breach_investigate",
  casefileId: null,
  exceptionId: null,
  exceptionStatus: null,
  recommendation: null,
  ...over,
});

const one = (over, opts) => railItems([row(over)], opts)[0];

// ------------------------------------------------------------------ items

test("railItems: every open-breach status is a breach dot with the minimum in the subline", () => {
  for (const status of ["breach_investigate", "in_review", "investigating", "investigation_paused", "awaiting_docs"]) {
    const it = one({ status });
    assert.equal(it.dot, "breach", status);
    assert.equal(it.dscrText, "1.12x", status);
    assert.equal(it.belowMinimum, true, status);
    assert.equal(it.subline, "Breach · min 1.25x", status);
    assert.equal(it.borrower, "Dokusign Inc");
    assert.equal(it.facilityId, "F7");
  }
});

test("railItems: decided is its own dot and says so", () => {
  const it = one({ status: "decided" });
  assert.equal(it.dot, "decided");
  assert.equal(it.subline, "Breach · decided");
});

test("railItems: compliant is a pass, not below minimum", () => {
  const it = one({ status: "compliant", ours: 1.59, required: 1.35 });
  assert.equal(it.dot, "pass");
  assert.equal(it.subline, "In compliance · min 1.35x");
  assert.equal(it.dscrText, "1.59x");
  assert.equal(it.belowMinimum, false);
});

test("railItems: not tested without approved terms waits for the terms", () => {
  const it = one({ status: "not_tested", hasApprovedTerms: false, ours: null, required: null });
  assert.equal(it.dot, "terms");
  assert.equal(it.subline, "Terms awaiting approval");
  assert.equal(it.dscrText, "—");
  assert.equal(it.belowMinimum, false);
});

test("railItems: not tested with terms names the minimum when it has one", () => {
  const withMin = one({ status: "not_tested", ours: null, required: 1.4 });
  assert.equal(withMin.dot, "untested");
  assert.equal(withMin.subline, "Not tested · min 1.40x");
  const noMin = one({ status: "not_tested", ours: null, required: null });
  assert.equal(noMin.dot, "untested");
  assert.equal(noMin.subline, "Not tested");
});

test("railItems: no computed figure reads as a dash and is never below minimum", () => {
  const it = one({ ours: null, required: 1.25 });
  assert.equal(it.dscrText, "—");
  assert.equal(it.belowMinimum, false);
});

test("railItems: href follows the casefile, then covenant setup, and a filter path wins", () => {
  assert.equal(one({ casefileId: "c1" }).href, "/casefiles/c1");
  assert.equal(one({ casefileId: null }).href, "/facilities/F7/covenant-setup");
  assert.equal(one({ casefileId: "c1" }, { filterPath: "/documents" }).href, "/documents?loan=F7");
  assert.equal(one({ casefileId: null }, { filterPath: "/terms" }).href, "/terms?loan=F7");
});

test("railItems: keeps row order", () => {
  const items = railItems([row({ facilityId: "F3" }), row({ facilityId: "F1" }), row({ facilityId: "F5" })]);
  assert.deepEqual(items.map((i) => i.facilityId), ["F3", "F1", "F5"]);
});

// ------------------------------------------------------------------- tabs

test("TABS: the five tabs, in order", () => {
  assert.equal(TABS.length, 5);
  assert.deepEqual(TABS.map((t) => t.href), ["/", "/documents", "/terms", "/lessons", "/governance"]);
});

test("activeTab: nested routes light their parent tab", () => {
  assert.equal(activeTab("/"), "/");
  assert.equal(activeTab("/casefiles/x"), "/");
  assert.equal(activeTab("/borrowers/new"), "/");
  assert.equal(activeTab("/borrowers/F1/onboarding"), "/");
  assert.equal(activeTab("/documents"), "/documents");
  assert.equal(activeTab("/documents/abc"), "/documents");
  assert.equal(activeTab("/terms"), "/terms");
  assert.equal(activeTab("/facilities/F1/covenant-setup"), "/terms");
  assert.equal(activeTab("/lessons"), "/lessons");
  assert.equal(activeTab("/governance"), "/governance");
});

// -------------------------------------------------------------- selection

test("selectedFacility: from the casefile, the setup path, or the loan param", () => {
  const rows = [row({ facilityId: "F1", casefileId: "c1" }), row({ facilityId: "F3", casefileId: "c3" })];
  assert.equal(selectedFacility("/casefiles/c1", null, rows), "F1");
  assert.equal(selectedFacility("/casefiles/c3", null, rows), "F3");
  assert.equal(selectedFacility("/casefiles/zzz", null, rows), null);
  assert.equal(selectedFacility("/facilities/F3/covenant-setup", null, rows), "F3");
  assert.equal(selectedFacility("/documents", "F5", rows), "F5");
  assert.equal(selectedFacility("/", null, rows), null);
});

test("selectedFacility: a malformed escape in the path returns null instead of throwing", () => {
  const rows = [row({ facilityId: "F3", casefileId: "c3" })];
  assert.equal(selectedFacility("/facilities/%E0%A4%A/covenant-setup", null, rows), null);
});

test("selectedFacility: the loan param selects on /terms too", () => {
  const rows = [row({ facilityId: "F5", casefileId: "c5" })];
  assert.equal(selectedFacility("/terms", "F5", rows), "F5");
});

// -------------------------------------------------------------- collapse

test("railDefaultCollapsed: only the reading tabs start collapsed", () => {
  for (const p of ["/lessons", "/governance"]) assert.equal(railDefaultCollapsed(p), true, p);
  for (const p of ["/", "/casefiles/x", "/documents", "/terms", "/facilities/F1/covenant-setup", "/borrowers/new"]) {
    assert.equal(railDefaultCollapsed(p), false, p);
  }
});

test("readRailPref: stored choice, or null when there is none to read", () => {
  assert.equal(RAIL_PREF_KEY, "cs.rail.collapsed");
  assert.equal(readRailPref({ getItem: () => "1" }), true);
  assert.equal(readRailPref({ getItem: () => "0" }), false);
  assert.equal(readRailPref({ getItem: () => null }), null);
  assert.equal(readRailPref(null), null);
  assert.equal(readRailPref(undefined), null);
  assert.equal(readRailPref({ getItem: () => { throw new Error("denied"); } }), null);
});

test("isRailToggleKey: bare [ outside a field only", () => {
  assert.equal(isRailToggleKey({ key: "[" }), true);
  assert.equal(isRailToggleKey({ key: "[", metaKey: true }), false);
  assert.equal(isRailToggleKey({ key: "[", ctrlKey: true }), false);
  assert.equal(isRailToggleKey({ key: "[", altKey: true }), false);
  for (const targetTag of ["INPUT", "TEXTAREA", "SELECT"]) assert.equal(isRailToggleKey({ key: "[", targetTag }), false, targetTag);
  assert.equal(isRailToggleKey({ key: "[", targetEditable: true }), false);
  assert.equal(isRailToggleKey({ key: "]" }), false);
});
