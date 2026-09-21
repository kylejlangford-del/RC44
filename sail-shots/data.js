/* RC44 Sail Shots — scan library. Each entry is one sail-scan photo plus the numbers
 * that go with it. The scan-analysis numbers (camber table, batten, mechanic settings)
 * aren't machine-readable off the photo, so they're entered once through "Add scan" and
 * live here from then on — same download/replace pattern as the batten inventory.
 */
window.SAIL_SHOTS = [
  {
    id: "2026-06-27-141956-gemera-mn2",
    boat: "gemera",
    file: "./photos/2026-06-27_141956_gemera_mn2.jpg",
    time: "2026-06-27T14:19:56",
    battenLabel: "Mn2 RedBattens 26mm Chock — STBD",
    wind: { tws: 12.5, twa: 29 },
    boat_: { bsp: 7.7 },
    mechanic: { forestay: 999.0, rake: 5.75, trimtab: -5 },
    camber: [
      { height: 25, camber: 7.0, draft: 44.2, twist: 0.0, entry: 10.3, exit: 10.1, foreCam: 71.1, backCam: 66.7 },
      { height: 50, camber: 7.7, draft: 48.2, twist: 5.7, entry: 13.4, exit: 12.6, foreCam: 70.6, backCam: 67.8 },
      { height: 75, camber: 5.5, draft: 46.8, twist: 11.3, entry: 10.5, exit: 9.9, foreCam: 71.9, backCam: 68.7 },
      { height: 87, camber: 4.1, draft: 44.1, twist: 13.7, entry: 8.7, exit: 6.6, foreCam: 72.2, backCam: 67.8 }
    ]
  }
];
