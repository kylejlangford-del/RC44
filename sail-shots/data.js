/* RC44 Sail Shots — scan library. Each entry is one sail-scan photo plus the numbers
 * that go with it, entered once through "Add scan" (the numbers aren't machine-readable
 * off the photo) and kept here from then on — same download/replace pattern as the
 * batten inventory.
 *
 * mast: {x1,y1,x2,y2} — two points marking the mast line (top, then base/gooseneck),
 * as fractions (0-1) of the photo's natural width/height. Used to align and scale the
 * overlay so two boats' masts line up exactly. null = not calibrated yet — set it via
 * "Recalibrate mast" on the scan for an accurate overlay.
 */
window.SAIL_SHOTS = [
  {
    id: "2026-06-27-141956-gemera-mn2",
    boat: "gemera",
    event: "",
    file: "./photos/2026-06-27_141956_gemera_mn2.jpg",
    time: "2026-06-27T14:19:56",
    tack: "STBD",
    battenLabel: "Mn2 RedBattens 26mm Chock",
    wind: { tws: 12.5, twa: 29 },
    boat_: { bsp: 7.7 },
    mechanic: { forestay: 999.0, rake: 5.75, trimtab: -5, mastSetup: null, mainSheetMark: null, chockSize: "26mm" },
    mast: null,
    camber: [
      { height: 25, camber: 7.0, draft: 44.2, twist: 0.0, entry: 10.3, exit: 10.1, foreCam: 71.1, backCam: 66.7 },
      { height: 50, camber: 7.7, draft: 48.2, twist: 5.7, entry: 13.4, exit: 12.6, foreCam: 70.6, backCam: 67.8 },
      { height: 75, camber: 5.5, draft: 46.8, twist: 11.3, entry: 10.5, exit: 9.9, foreCam: 71.9, backCam: 68.7 },
      { height: 87, camber: 4.1, draft: 44.1, twist: 13.7, entry: 8.7, exit: 6.6, foreCam: 72.2, backCam: 67.8 }
    ]
  },
  {
    id: "2026-06-27-112308-artemis-m12",
    boat: "artemis",
    event: "",
    file: "./photos/2026-06-27_112308_artemis_m12.jpg",
    time: "2026-06-27T11:23:08",
    tack: "STBD",
    battenLabel: "M-12",
    wind: { tws: 8.0, twa: 999 },
    boat_: { bsp: 999.0 },
    mechanic: { forestay: 999.0, rake: null, trimtab: null, mastSetup: -1.0, mainSheetMark: 3.75, chockSize: null },
    mast: null,
    camber: [
      { height: 25, camber: 8.5, draft: 46.0, twist: -0.0, entry: 13.5, exit: 12.7, foreCam: 65.9, backCam: 66.4 },
      { height: 50, camber: 10.0, draft: 42.4, twist: 4.6, entry: 17.8, exit: 14.8, foreCam: 70.8, backCam: 68.8 },
      { height: 75, camber: 8.9, draft: 41.8, twist: 9.1, entry: 23.2, exit: 12.9, foreCam: 77.2, backCam: 67.6 },
      { height: 87, camber: 6.3, draft: 41.6, twist: 10.9, entry: 18.3, exit: 9.6, foreCam: 76.9, backCam: 67.8 }
    ]
  }
];
