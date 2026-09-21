/* RC44 Main Batten inventory — seeded from the Artemis/Gemera batten spreadsheets on 2026-09-21.
 * This file is the single source of truth once you start editing through the page.
 * Structure: BATTEN_DATA[boat][position] = { installed: <battenId|null>, battens: [ {id, name, ei, length, serial, notes, decommissioned} ] }
 */
window.BATTEN_DATA = {
  artemis: {
    boatLabel: "Artemis",
    // No single reliable "currently installed" marker was found across the Artemis
    // spreadsheet's several overlapping tables — installed picks below start unset.
    // Set them once here and this file becomes the record going forward.
    positions: {
      1: { installed: null, battens: [
        { id: "art-1-soft", name: "Artemis SOFT MN #1", ei: 160, sail: "M12", notes: "" },
        { id: "art-1-lt", name: "Artemis LT MN #1", ei: 184, sail: "M11 / M13", notes: "" },
        { id: "art-1-ap", name: "Artemis AP MN #1", ei: 219, sail: "M11 / M12", notes: "" },
        { id: "art-1-stiff", name: "Artemis STIFF MN #1", ei: 220, sail: "M12", notes: "" },
        { id: "art-1-mn1stiff", name: "MN1 Stiff red", ei: 230, sail: "MN1", notes: "Good when you can keep main set" },
        { id: "art-1-gemblue", name: "Gemera MN1 Medium blue", ei: 230, sail: "MN1", notes: "Top end G1, low end J2" },
        { id: "art-1-hvy", name: "Artemis HVY MN #1", ei: 233, sail: "M11", notes: "" },
        { id: "art-1-ap13", name: "Artemis AP MN #1", ei: 236, sail: "M13", notes: "" },
        { id: "art-1-mn0", name: "MN-0", ei: 273, sail: "MN-0", notes: "Check bend profile — seems stiff at luff" },
        { id: "art-1-dbl", name: "MN1 Stiff + double red", ei: 313, sail: "MN1", notes: "Good top end of J2/J3 when blowing out the main" },
        { id: "art-1-ustiff", name: "MN #1 U STIFF", ei: 450, sail: "M12", notes: "" },
        { id: "art-1-triple", name: "MN1 Super stiff triple red", ei: 450, sail: "MN1", notes: "1-2% target camber, 20kts+" }
      ]},
      2: { installed: null, battens: [
        { id: "art-2-soft", name: "Artemis MN Soft #2", ei: 50, sail: "M12", notes: "" },
        { id: "art-2-green", name: "MN1 Soft green", ei: 60, sail: "MN1", notes: "Low end G1" },
        { id: "art-2-lt", name: "Artemis LT MN #2", ei: 61, sail: "M11", notes: "" },
        { id: "art-2-ap", name: "Artemis AP MN #2", ei: 64, sail: "M11 / M12 / M13", notes: "" },
        { id: "art-2-gemblue", name: "Gemera MN1 Medium blue", ei: 66, sail: "MN1", notes: "Top end G1, low end J2" },
        { id: "art-2-stiff", name: "Artemis MN Stiff #2", ei: 82, sail: "M12", notes: "" },
        { id: "art-2-mn1stiff", name: "MN1 Stiff red", ei: 87, sail: "MN1", notes: "Good when you can keep main set" },
        { id: "art-2-hvy", name: "Artemis HVY MN #2", ei: 91, sail: "M11", notes: "" },
        { id: "art-2-mn0", name: "MN-0", ei: 101, sail: "MN-0", notes: "" },
        { id: "art-2-dbl", name: "MN1 Stiff + double red", ei: 149, sail: "MN1", notes: "Good top end of J2/J3 when blowing out the main" },
        { id: "art-2-ustiff", name: "MN #2 U STIFF", ei: 550, sail: "M12", notes: "" },
        { id: "art-2-triple", name: "MN1 Super stiff triple red", ei: 550, sail: "MN1", notes: "1-2% target camber, 20kts+ no main" }
      ]},
      3: { installed: null, battens: [
        { id: "art-3-ap12", name: "Artemis MN AP #3", ei: 122, sail: "M11 / M12", notes: "" },
        { id: "art-3-gemblue", name: "Gemera MN1 Medium blue", ei: 125, sail: "MN1", notes: "" },
        { id: "art-3-ap11", name: "Artemis AP MN #3", ei: 133, sail: "M11", notes: "" },
        { id: "art-3-gemstiff", name: "Gemera MN1 Stiff red", ei: 135, sail: "MN1", notes: "" },
        { id: "art-3-stiff", name: "Artemis MN STIFF #3", ei: 137, sail: "M12", notes: "" },
        { id: "art-3-hvy", name: "Artemis HVY MN #3", ei: 144, sail: "M11", notes: "" },
        { id: "art-3-mn0", name: "MN-0", ei: 174, sail: "MN-0", notes: "" },
        { id: "art-3-rc44-94", name: "RC44 B3 94", ei: 94, sail: "", notes: "New batten — too long" },
        { id: "art-3-rc44-180", name: "RC44 B3 180", ei: 180, sail: "", notes: "New batten — too long" },
        { id: "art-3-rc44-240", name: "RC44 B3 240", ei: 240, sail: "", notes: "New batten — too long" },
        { id: "art-3-dbl", name: "MN1 Stiff + double red", ei: 211, sail: "MN1", notes: "Good top end of J2/J3 when blowing out the main" },
        { id: "art-3-super", name: "Home made super stiff", ei: null, sail: "M12", notes: "Added for Mastrand 25" }
      ]},
      4: { installed: null, battens: [
        { id: "art-4-ap12", name: "Artemis MN AP #4", ei: 150, sail: "M11 / M12", notes: "" },
        { id: "art-4-stiff", name: "Artemis Stiff MN #4", ei: 154, sail: "M11", notes: "" },
        { id: "art-4-mn1stiff", name: "MN1 Stiff red", ei: 158, sail: "MN1", notes: "" },
        { id: "art-4-gemblue", name: "Gemera MN1 Medium blue", ei: 158, sail: "MN1", notes: "" },
        { id: "art-4-ap11", name: "Artemis AP MN #4", ei: 158, sail: "M11", notes: "" },
        { id: "art-4-hvy", name: "Artemis MN HVY #4", ei: 174, sail: "M12", notes: "5mm longer than AP — check it fits" },
        { id: "art-4-mn0", name: "MN-0", ei: 237, sail: "MN-0", notes: "" },
        { id: "art-4-rc44-172", name: "RC44 B4 172", ei: 172, sail: "", notes: "New batten — too long" },
        { id: "art-4-homemade", name: "#4 Heavy (home made)", ei: null, sail: "M11", notes: "Need to test EI" }
      ]},
      5: { installed: null, battens: [
        { id: "art-5-ap11", name: "Artemis AP MN #5", ei: 132, sail: "M11", notes: "" },
        { id: "art-5-gemblue", name: "Gemera MN1 Medium blue", ei: 158, sail: "MN1", notes: "" },
        { id: "art-5-ap12", name: "Artemis MN AP #5", ei: 237, sail: "M11 / M12", notes: "" },
        { id: "art-5-mn1stiff", name: "MN1 Stiff red", ei: 255, sail: "MN1", notes: "" },
        { id: "art-5-stiff", name: "Artemis MN Stiff #5", ei: 260, sail: "M12", notes: "Add foam in flat water and breeze" },
        { id: "art-5-hvy", name: "Artemis HVY MN #5", ei: 262, sail: "M11", notes: "" },
        { id: "art-5-mn0", name: "MN-0", ei: 290, sail: "MN-0", notes: "" },
        { id: "art-5-rc44-219", name: "RC44 #5", ei: 219, sail: "", notes: "" },
        { id: "art-5-rc44-293", name: "RC44 #5", ei: 293, sail: "", notes: "" }
      ]},
      6: { installed: null, battens: [
        { id: "art-6-soft", name: "Artemis SOFT MN #6", ei: 210, sail: "M11", notes: "" },
        { id: "art-6-green", name: "Gemera MN1 Soft green", ei: 220, sail: "MN1", notes: "Only use down range G1" },
        { id: "art-6-lt", name: "Artemis LT MN #6", ei: 229, sail: "M12", notes: "" },
        { id: "art-6-mn0", name: "MN-0", ei: 294, sail: "MN-0", notes: "" },
        { id: "art-6-stiff", name: "Artemis Stiff MN #6", ei: 317, sail: "M11", notes: "" },
        { id: "art-6-mn1stiff", name: "MN1 Stiff red", ei: 320, sail: "MN1", notes: "" },
        { id: "art-6-gemblue", name: "Gemera MN1 Medium blue", ei: 320, sail: "MN1", notes: "" },
        { id: "art-6-ap", name: "Artemis MN AP #6", ei: 321, sail: "M11 / M12", notes: "" },
        { id: "art-6-apsolo", name: "Artemis AP MN #6", ei: 333, sail: "M11", notes: "" },
        { id: "art-6-heavy", name: "Artemis Heavy MN #6", ei: 338, sail: "M11", notes: "" }
      ]}
    }
  },

  gemera: {
    boatLabel: "Gemera",
    positions: {
      1: { installed: "gem-1-stiff", battens: [
        { id: "gem-1-green", name: "MN1 Soft green", ei: 175, serial: "52258", notes: "Low end G1" },
        { id: "gem-1-stiff", name: "MN1 Stiff red", ei: 230, serial: "52246", notes: "Good when you can keep main set" },
        { id: "gem-1-dbl", name: "MN1 Stiff + double red", ei: 313, serial: "52801", notes: "Good top end of J2/J3 when blowing out the main" },
        { id: "gem-1-triple", name: "MN1 Super stiff triple red", ei: 450, serial: "52261", notes: "1-2% target camber, 20kts+" }
      ]},
      2: { installed: "gem-2-stiff", battens: [
        { id: "gem-2-green", name: "MN1 Soft green", ei: 60, serial: "52259", notes: "Low end G1" },
        { id: "gem-2-stiff", name: "MN1 Stiff red", ei: 87, serial: "52247", notes: "Good when you can keep main set" },
        { id: "gem-2-blue", name: "Gemera MN1 Medium blue", ei: 66, serial: "52253", notes: "Top end G1, low end J2" },
        { id: "gem-2-dbl", name: "MN1 Stiff + double red", ei: 149, serial: "52803", notes: "Good top end of J2/J3 when blowing out the main" },
        { id: "gem-2-triple", name: "MN1 Super stiff triple red", ei: 550, serial: "52262", notes: "1-2% target camber, 20kts+ no main" }
      ]},
      3: { installed: "gem-3-rc44-180", battens: [
        { id: "gem-3-blue", name: "Gemera MN1 Medium blue", ei: 125, serial: "52254", notes: "" },
        { id: "gem-3-rc44-94", name: "RC44 B3 94", ei: 94, notes: "New batten" },
        { id: "gem-3-rc44-180", name: "RC44 B3 177", ei: 180, notes: "New batten" },
        { id: "gem-3-stiff", name: "MN1 Stiff red", ei: 135, serial: "52248", notes: "" },
        { id: "gem-3-dbl", name: "MN1 Stiff + double red", ei: 211, serial: "52748", notes: "Good top end of J2/J3 when blowing out the main" },
        { id: "gem-3-rc44-240", name: "RC44 B3 240", ei: 240, notes: "New batten" }
      ]},
      4: { installed: "gem-4-stiff", battens: [
        { id: "gem-4-stiff", name: "MN1 Stiff red", ei: 158, serial: "52249", notes: "" },
        { id: "gem-4-rc44-172", name: "RC44 B4 172", ei: 172, notes: "New batten" }
      ]},
      5: { installed: "gem-5-rc44-210", battens: [
        { id: "gem-5-blue", name: "MN1 med blue", ei: 158, serial: "52256", notes: "" },
        { id: "gem-5-rc44-210", name: "RC44 B5 210", ei: 206, notes: "New batten" },
        { id: "gem-5-stiff", name: "MN1 Stiff red", ei: 255, serial: "52250", notes: "" },
        { id: "gem-5-rc44-300", name: "RC44 B5 300", ei: 297, notes: "New batten" }
      ]},
      6: { installed: "gem-6-stiff", battens: [
        { id: "gem-6-stiff", name: "MN1 Stiff red", ei: 320, serial: "52251", notes: "" },
        { id: "gem-6-green", name: "Gemera MN1 Soft green", ei: 220, serial: "52260", notes: "Only use down range G1" }
      ]}
    }
  }
};
