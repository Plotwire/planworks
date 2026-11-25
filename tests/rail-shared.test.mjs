// The Timesheets page has the same left rail as the dashboard: the same
// buttons in the same order, the same markup (teal icon, slide-out name on
// mouse hover, short name on touch), and exactly the same styles.
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the Timesheets rail's styles are the dashboard's, exactly", () => {
  const home = read("components/HomeScreen.jsx");
  const start = home.indexOf("/* Left rail (Joe, 17 Nov).");
  const end = home.indexOf(".pw-home .rail-spacer");
  assert.ok(start > 0 && end > start, "the dashboard's rail styles are where expected");
  const expected = home.slice(start, end)
    .replace(/\.pw-home \.rail\{/g, ".pw-ts .ts-rail{")
    .replace(/\.pw-home/g, ".pw-ts");
  assert.ok(read("components/timesheets/TimesheetsHome.jsx").includes(expected),
    "TimesheetsHome.jsx carries the dashboard's rail styles, scoped to .pw-ts (copy them across again)");
});

test("the same buttons, in the same order, with the same markup", () => {
  const home = read("components/HomeScreen.jsx");
  const rail = home.slice(home.indexOf('<aside className="rail">'), home.indexOf('<div className="rail-spacer">'));
  const dashboard = [...rail.matchAll(/<RailItem (?:active )?name="([^"]+)" short="([^"]+)"/g)].map((m) => `${m[1]}/${m[2]}`);
  const links = read("components/AppRailLinks.jsx");
  const shared = [...links.matchAll(/name: "([^"]+)", short: "([^"]+)"/g)].map((m) => `${m[1]}/${m[2]}`);
  assert.deepEqual(shared, dashboard);
  // RailItem's markup: navitem > navpill (icon + navname), then navshort.
  assert.match(home, /<span className="navpill">\{icon\}<span className="navname">\{name\}<\/span><\/span>\s*<span className="navshort" aria-hidden="true">\{short\}<\/span>/);
  assert.match(links, /className=\{`navitem\$\{active \? " active" : ""\}`\}/);
  assert.match(links, /<span className="navname">\{name\}<\/span>\s*<\/span>\s*<span className="navshort" aria-hidden="true">\{short\}<\/span>/);
  // No browser tooltips: one behaviour, as on the dashboard.
  assert.doesNotMatch(links, /\btitle=/);
});

test("All drawings from the Timesheets rail opens the dashboard's list", () => {
  assert.match(read("components/AppRailLinks.jsx"), /href: "\/#drawings", name: "All drawings"/);
  assert.match(read("components/HomeScreen.jsx"), /window\.location\.hash !== "#drawings"\) return undefined;[\s\S]{0,200}setTimeout\(showAllDrawings, 150\)/);
});
