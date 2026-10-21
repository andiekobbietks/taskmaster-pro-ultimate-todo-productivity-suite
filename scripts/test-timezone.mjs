/**
 * The time zone arithmetic, with the edges that break it.
 *
 * Dublin is used throughout because it is the awkward one: it is UTC in
 * winter and UTC+1 in summer, and it changes at 01:00 local on the last
 * Sunday in March and October â€” which is exactly when a naive
 * implementation of "08:00 local" goes wrong.
 *
 * Run: node --experimental-strip-types scripts/test-timezone.mjs
 */
import {
  isValidTimeZone,
  offsetMinutes,
  localParts,
  localDateString,
  localMinutesOfDay,
  instantForLocal,
  daysUntilInZone,
  describeZone,
} from "../src/timezone.ts";

let pass = 0;
let fail = 0;
const failures = [];

function check(label, actual, expected) {
  if (Object.is(actual, expected)) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    failures.push(label);
    console.log("  FAIL " + label);
    console.log("       expected " + expected);
    console.log("       actual   " + actual);
  }
}

function checkTrue(label, condition, detail = "") {
  if (condition) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    failures.push(label);
    console.log("  FAIL " + label + (detail ? " â€” " + detail : ""));
  }
}

const DUBLIN = "Europe/Dublin";
const LONDON = "Europe/London";
const NEW_YORK = "America/New_York";
const KOLKATA = "Asia/Kolkata";
const AUCKLAND = "Pacific/Auckland";

console.log("\n=== the zones are known ===");
check("Dublin is a zone", isValidTimeZone(DUBLIN), true);
check("nonsense is not", isValidTimeZone("Mars/Olympus_Mons"), false);
check("an empty string is not", isValidTimeZone(""), false);
check("null is not", isValidTimeZone(null), false);

console.log("\n=== the offsets ===");
// 2026-01-15T12:00:00Z: Dublin is on GMT in January.
check("Dublin is UTC+0 in January", offsetMinutes(DUBLIN, new Date("2026-01-15T12:00:00Z")), 0);
// 2026-07-15T12:00:00Z: Dublin is on IST in July.
check("Dublin is UTC+1 in July", offsetMinutes(DUBLIN, new Date("2026-07-15T12:00:00Z")), 60);
check("London is UTC+1 in July", offsetMinutes(LONDON, new Date("2026-07-15T12:00:00Z")), 60);
check("New York is UTC-4 in July", offsetMinutes(NEW_YORK, new Date("2026-07-15T12:00:00Z")), -240);
check("Kolkata is UTC+5:30", offsetMinutes(KOLKATA, new Date("2026-07-15T12:00:00Z")), 330);
check("Auckland is UTC+12 in July", offsetMinutes(AUCKLAND, new Date("2026-07-15T12:00:00Z")), 720);
check("New York is UTC-5 in January", offsetMinutes(NEW_YORK, new Date("2026-01-15T12:00:00Z")), -300);

console.log("\n=== the wall clock in a zone ===");
const noon = new Date("2026-07-15T12:00:00Z");
check("12:00 UTC is 13:00 in Dublin", localParts(DUBLIN, noon).hour, 13);
check("12:00 UTC is 17:30 in Kolkata", localParts(KOLKATA, noon).hour, 17);
check("12:00 UTC is 17:30 in Kolkata, half past", localParts(KOLKATA, noon).minute, 30);
check("12:00 UTC is 08:00 in New York", localParts(NEW_YORK, noon).hour, 8);
check("the date can differ too", localDateString(NEW_YORK, new Date("2026-07-15T02:00:00Z")), "2026-07-14");
check("minutes since local midnight", localMinutesOfDay(KOLKATA, noon), 17 * 60 + 30);

console.log("\n=== finding 08:00 local ===");
// A normal winter morning.
const winter = instantForLocal(DUBLIN, 2026, 1, 15, 8, 0);
check("08:00 Dublin in January is 08:00 UTC", winter.toISOString(), "2026-01-15T08:00:00.000Z");
// A normal summer morning.
const summer = instantForLocal(DUBLIN, 2026, 7, 15, 8, 0);
check("08:00 Dublin in July is 07:00 UTC", summer.toISOString(), "2026-07-15T07:00:00.000Z");
check("and it reads as 08:00 in Dublin", localParts(DUBLIN, summer).hour, 8);

// The spring-forward morning: Dublin jumps 01:00 -> 02:00 on
// 2026-03-29. 08:00 still happens, and it happens at 07:00 UTC.
const spring = instantForLocal(DUBLIN, 2026, 3, 29, 8, 0);
check("08:00 Dublin on the spring-forward day is 07:00 UTC", spring.toISOString(), "2026-03-29T07:00:00.000Z");

// The fall-back morning: Dublin goes 02:00 -> 01:00 on 2026-10-25.
// 08:00 happens once, at 08:00 UTC (the change is at 02:00 local).
const autumn = instantForLocal(DUBLIN, 2026, 10, 25, 8, 0);
check("08:00 Dublin on the fall-back day is 08:00 UTC", autumn.toISOString(), "2026-10-25T08:00:00.000Z");
check("and it reads as 08:00 in Dublin", localParts(DUBLIN, autumn).hour, 8);

// The awkward one: a local time that does not exist.
const missing = instantForLocal(DUBLIN, 2026, 3, 29, 2, 30);
checkTrue(
  "a local time that does not exist still gives an instant",
  missing instanceof Date && !Number.isNaN(missing.getTime()),
  "invalid date"
);
checkTrue(
  "and it lands on a real local time",
  localParts(DUBLIN, missing).hour === 3 || localParts(DUBLIN, missing).hour === 2,
  "local hour is " + localParts(DUBLIN, missing).hour
);

// A local time that happens twice: 01:30 on 2026-10-25 happens twice
// in Dublin. The first one is the answer.
const twice = instantForLocal(DUBLIN, 2026, 10, 25, 1, 30);
check("the first 01:30 is chosen", twice.toISOString(), "2026-10-25T00:30:00.000Z");

// Zones far from UTC.
const kolkataMorning = instantForLocal(KOLKATA, 2026, 7, 15, 8, 0);
check("08:00 in Kolkata is 02:30 UTC", kolkataMorning.toISOString(), "2026-07-15T02:30:00.000Z");
const aucklandMorning = instantForLocal(AUCKLAND, 2026, 7, 15, 8, 0);
check("08:00 in Auckland is 20:00 UTC the day before", aucklandMorning.toISOString(), "2026-07-14T20:00:00.000Z");

console.log("\n=== counting days ===");
// Noon UTC: 13:00 in Dublin on the 21st, and the same day in Auckland
// (UTC+12 is still the 22nd at noon? no - Auckland is 00:00 on the
// 22nd, so it is the 22nd there). The point is that the two zones
// disagree about which day it is, and the count follows the zone.
const midday = new Date("2026-10-21T12:00:00Z");
check("it is the 21st in Dublin", localDateString(DUBLIN, midday), "2026-10-21");
check("it is the 22nd in Auckland", localDateString(AUCKLAND, midday), "2026-10-22");
check("days until tomorrow is 1 in Dublin", daysUntilInZone(DUBLIN, "2026-10-22", midday), 1);
check("days until tomorrow is 0 in Auckland", daysUntilInZone(AUCKLAND, "2026-10-22", midday), 0);
check("a deadline today is 0 days", daysUntilInZone(DUBLIN, "2026-10-21", midday), 0);
check("a deadline yesterday is -1", daysUntilInZone(DUBLIN, "2026-10-20", midday), -1);
check("nonsense gives null", daysUntilInZone(DUBLIN, "not a date"), null);
check("an empty date gives null", daysUntilInZone(DUBLIN, ""), null);

// Late in the evening the zones really do disagree about today.
const lateEvening = new Date("2026-10-21T23:30:00Z");
check("it is the 22nd in Dublin by then", localDateString(DUBLIN, lateEvening), "2026-10-22");
check("and still the 22nd in Auckland", localDateString(AUCKLAND, lateEvening), "2026-10-22");
check("a deadline on the 21st is already yesterday in Dublin",
      daysUntilInZone(DUBLIN, "2026-10-21", lateEvening), -1);

console.log("\n=== describing a zone ===");
checkTrue(
  "Dublin in July is described as UTC+01:00",
  describeZone(DUBLIN, new Date("2026-07-15T12:00:00Z")).includes("UTC+01:00"),
  describeZone(DUBLIN, new Date("2026-07-15T12:00:00Z"))
);
checkTrue(
  "New York in July is described as UTC-04:00",
  describeZone(NEW_YORK, new Date("2026-07-15T12:00:00Z")).includes("UTC-04:00"),
  describeZone(NEW_YORK, new Date("2026-07-15T12:00:00Z"))
);
check("a nonsense zone says so", describeZone("Mars/Olympus_Mons"), "Unknown time zone");

console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAILED: " + f);
console.log("=".repeat(60));
process.exit(fail > 0 ? 1 : 0);

