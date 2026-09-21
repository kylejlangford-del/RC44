/* RC44 Main Batten inventory — reseeded from the Artemis and Gemera batten spreadsheets on 2026-09-21.
 * Battens are now grouped per mainsail (Artemis: M12 / M13, Gemera: M1 / M2) since the usable
 * inventory changes with which main is bent on. This file is the source of truth once you start
 * editing through the page; leftover/retired battens from the sheets were intentionally left out.
 * Structure: BATTEN_DATA[boat].bySail[mainsail][position] = { installed: <battenId|null>, battens: [...] }
 */
window.BATTEN_DATA = {
  "artemis": {
    "boatLabel": "Artemis",
    "mainsails": [
      "M12",
      "M13"
    ],
    "bySail": {
      "M12": {
        "1": {
          "installed": null,
          "battens": [
            {
              "id": "art-m12-1-soft",
              "name": "Artemis SOFT MN #1",
              "ei": 160,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m12-1-lt",
              "name": "Artemis LT MN#1",
              "ei": 184,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m12-1-stiff",
              "name": "Artemis stiff #1",
              "ei": 220,
              "notes": ""
            },
            {
              "id": "art-m12-1-ustiff",
              "name": "MN #1 U STIFF",
              "ei": 450,
              "notes": ""
            }
          ]
        },
        "2": {
          "installed": null,
          "battens": [
            {
              "id": "art-m12-2-ap",
              "name": "Artemis MN AP #2",
              "ei": 64,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m12-2-b2stiff",
              "name": "Artemis MN #B2 StIff",
              "ei": 152,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m12-2-ustiff",
              "name": "MN #2 U STIFF",
              "ei": 550,
              "notes": ""
            },
            {
              "id": "art-m12-2-mn2",
              "name": "Artemis MN#2",
              "ei": 90,
              "notes": "Untapered",
              "manufacturer": "C Tech"
            }
          ]
        },
        "3": {
          "installed": null,
          "battens": [
            {
              "id": "art-m12-3-b3stiff",
              "name": "Artemis MN #B3 Stiff",
              "ei": 214,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m12-3-homemade",
              "name": "Home made super stiff",
              "ei": null,
              "notes": "Super stiff added for Mastrand 25",
              "serial": "15x10 A",
              "manufacturer": "HCB"
            },
            {
              "id": "art-m12-3-penned",
              "name": "Artemis MN#3 (penned #3)",
              "ei": 117,
              "notes": "Untapered",
              "manufacturer": "C Tech"
            }
          ]
        },
        "4": {
          "installed": null,
          "battens": [
            {
              "id": "art-m12-4-hvy",
              "name": "Artemis MN HVY #4",
              "ei": 174,
              "notes": "Add foam in flat water and breeze",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m12-4-rc44",
              "name": "RC44#4",
              "ei": 186,
              "notes": ""
            }
          ]
        },
        "5": {
          "installed": null,
          "battens": [
            {
              "id": "art-m12-5-stiff",
              "name": "Artemis MN Stiff #5",
              "ei": 260,
              "notes": "Add foam in flat water and breeze",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m12-5-mn5",
              "name": "Artemis MN#5",
              "ei": 161,
              "notes": ""
            },
            {
              "id": "art-m12-5-rc44a",
              "name": "RC44#5",
              "ei": 219,
              "notes": ""
            },
            {
              "id": "art-m12-5-rc44b",
              "name": "RC44 #5",
              "ei": 293,
              "notes": ""
            }
          ]
        },
        "6": {
          "installed": null,
          "battens": []
        }
      },
      "M13": {
        "1": {
          "installed": null,
          "battens": [
            {
              "id": "art-m13-1-ap",
              "name": "Artemis AP MN #1",
              "ei": 236,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m13-1-lt",
              "name": "Artemis LT MN#1",
              "ei": 184,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m13-1-stiff",
              "name": "Artemis stiff #1",
              "ei": 220,
              "notes": ""
            }
          ]
        },
        "2": {
          "installed": null,
          "battens": [
            {
              "id": "art-m13-2-mn2b",
              "name": "ArtemisMN2",
              "ei": 48,
              "notes": ""
            },
            {
              "id": "art-m13-2-ap",
              "name": "Artemis AP MN #2",
              "ei": 64,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m13-2-lt",
              "name": "Artemis LT MN #2",
              "ei": 61,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m13-2-hvy",
              "name": "Artemis HVY MN #2",
              "ei": 91,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m13-2-mn2",
              "name": "Artemis MN#2",
              "ei": 90,
              "notes": "Untapered",
              "manufacturer": "C Tech"
            }
          ]
        },
        "3": {
          "installed": null,
          "battens": [
            {
              "id": "art-m13-3-rc44-92",
              "name": "RC44#3",
              "ei": 92,
              "notes": "Untapered"
            },
            {
              "id": "art-m13-3-rc44-164",
              "name": "RC44#3",
              "ei": 164,
              "notes": ""
            },
            {
              "id": "art-m13-3-penned",
              "name": "Artemis MN#3 (penned #3)",
              "ei": 117,
              "notes": "Untapered",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m13-3-hvy",
              "name": "Artemis HVY MN#3",
              "ei": 144,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m13-3-ap",
              "name": "Artemis AP MN#3",
              "ei": 133,
              "notes": "",
              "manufacturer": "C Tech"
            }
          ]
        },
        "4": {
          "installed": null,
          "battens": [
            {
              "id": "art-m13-4-stiff",
              "name": "Artemis Stiff MN#4",
              "ei": 154,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m13-4-rc44",
              "name": "RC44#4",
              "ei": 186,
              "notes": ""
            }
          ]
        },
        "5": {
          "installed": null,
          "battens": [
            {
              "id": "art-m13-5-ap",
              "name": "Artemis AP MN#5",
              "ei": 132,
              "notes": "",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m13-5-mn5",
              "name": "Artemis MN#5",
              "ei": 161,
              "notes": ""
            },
            {
              "id": "art-m13-5-rc44a",
              "name": "RC44#5",
              "ei": 219,
              "notes": ""
            },
            {
              "id": "art-m13-5-rc44b",
              "name": "RC44 #5",
              "ei": 293,
              "notes": ""
            },
            {
              "id": "art-m13-5-hvy",
              "name": "Artemis HVY MN#5",
              "ei": 262,
              "notes": "",
              "manufacturer": "C Tech"
            }
          ]
        },
        "6": {
          "installed": null,
          "battens": [
            {
              "id": "art-m13-6-ap",
              "name": "Artemis MN AP #6",
              "ei": 321,
              "notes": "Brennen sail test",
              "manufacturer": "C Tech"
            },
            {
              "id": "art-m13-6-mn6",
              "name": "Artemis MN#6",
              "ei": 233,
              "notes": ""
            }
          ]
        }
      }
    }
  },
  "gemera": {
    "boatLabel": "Gemera",
    "mainsails": [
      "M1",
      "M2"
    ],
    "bySail": {
      "M1": {
        "1": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m1-1-soft",
              "name": "MN1 Soft green",
              "ei": 175,
              "notes": "Low end G1",
              "length": "2742mm",
              "serial": "52258",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-1-stiff",
              "name": "MN1 Stiff red",
              "ei": 230,
              "notes": "Good when you can keep main set",
              "length": "2742mm",
              "serial": "52246",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-1-dbl",
              "name": "MN1 Stiff + double red",
              "ei": 313,
              "notes": "Good top end of J2/J3 when you are blowing out the main",
              "length": "2742mm",
              "serial": "52801",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-1-triple",
              "name": "MN1 Super stiff triple red",
              "ei": 450,
              "notes": "1-2% target camber, good in 20kts +",
              "length": "2742mm",
              "serial": "52261",
              "manufacturer": "C-Tech"
            }
          ]
        },
        "2": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m1-2-soft",
              "name": "MN1 Soft green",
              "ei": 60,
              "notes": "Low end G1",
              "length": "3029mm",
              "serial": "52259",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-2-stiff",
              "name": "MN1 Stiff red",
              "ei": 87,
              "notes": "Good when you can keep main set",
              "length": "3029mm",
              "serial": "52247",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-2-blue",
              "name": "Gemera MN1 Medium blue",
              "ei": 66,
              "notes": "Top end G1, low end J2",
              "length": "3029mm",
              "serial": "52253",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-2-dbl",
              "name": "MN1 Stiff + double red",
              "ei": 149,
              "notes": "Good top end of J2/J3 when you are blowing out the main",
              "length": "3029mm",
              "serial": "52803",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-2-triple",
              "name": "MN1 Super stiff triple red",
              "ei": 550,
              "notes": "1-2% target camber, 20kts + when no chance of setting main",
              "length": "3029mm",
              "serial": "52262",
              "manufacturer": "C-Tech"
            }
          ]
        },
        "3": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m1-3-blue",
              "name": "Gemera MN1 Medium blue",
              "ei": 125,
              "notes": "",
              "length": "3600mm",
              "serial": "52254",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-3-rc44-94",
              "name": "RC44 B3 94",
              "ei": 94,
              "notes": "New batten",
              "length": "3600mm"
            },
            {
              "id": "gem-m1-3-rc44-177",
              "name": "RC44 B3 177",
              "ei": 180,
              "notes": "New batten",
              "length": "3600mm"
            },
            {
              "id": "gem-m1-3-stiff",
              "name": "MN1 Stiff red",
              "ei": 135,
              "notes": "",
              "length": "3600mm",
              "serial": "52248",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-3-dbl",
              "name": "MN1 Stiff + double red",
              "ei": 211,
              "notes": "Good top end of J2/J3 when you are blowing out the main",
              "length": "3600mm",
              "serial": "52748",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-3-rc44-240",
              "name": "RC44 B3 240",
              "ei": 240,
              "notes": "New batten",
              "length": "3600mm"
            }
          ]
        },
        "4": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m1-4-stiff",
              "name": "MN1 Stiff red",
              "ei": 158,
              "notes": "",
              "length": "4100mm",
              "serial": "52249",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-4-rc44",
              "name": "RC44 B4 172",
              "ei": 172,
              "notes": "New batten"
            }
          ]
        },
        "5": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m1-5-med",
              "name": "MN1 med blue",
              "ei": 158,
              "notes": "",
              "length": "4630mm",
              "serial": "52256",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-5-rc44-210",
              "name": "RC44 B5 210",
              "ei": 206,
              "notes": "New batten"
            },
            {
              "id": "gem-m1-5-stiff",
              "name": "MN1 Stiff red",
              "ei": 255,
              "notes": "",
              "length": "4630mm",
              "serial": "52250",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-5-rc44-300",
              "name": "RC44 B5 300",
              "ei": 297,
              "notes": "New batten"
            }
          ]
        },
        "6": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m1-6-stiff",
              "name": "MN1 Stiff red",
              "ei": 320,
              "notes": "",
              "length": "5027mm",
              "serial": "52251",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m1-6-soft",
              "name": "Gemera MN1 Soft green",
              "ei": 220,
              "notes": "Only use down range G1",
              "length": "5027mm",
              "serial": "52260",
              "manufacturer": "C-Tech"
            }
          ]
        }
      },
      "M2": {
        "1": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m2-1-mn0",
              "name": "MN-0",
              "ei": 273,
              "notes": "Check bend profile of this batten. Seems stiff at luff",
              "length": "2726mm",
              "serial": "49255",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-1-stiff",
              "name": "MN2 Stiff red",
              "ei": 230,
              "notes": "Top end G1, low end J2. Non tapered!",
              "length": "2753mm",
              "serial": "52252",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-1-triple",
              "name": "MN1 Super stiff triple red",
              "ei": 450,
              "notes": "1-2% target camber, good in 20kts +",
              "length": "2742mm",
              "serial": "52261",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-1-dbl",
              "name": "MN1 Stiff + double red",
              "ei": 313,
              "notes": "Good top end of J2/J3 when you are blowing out the main",
              "length": "2742mm",
              "serial": "52801",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-1-stiffred",
              "name": "MN1 Stiff red",
              "ei": 230,
              "notes": "Good when you can keep main set",
              "length": "2742mm",
              "serial": "52246",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-1-soft",
              "name": "MN1 Soft green",
              "ei": 175,
              "notes": "Low end G1",
              "length": "2742mm",
              "serial": "52258",
              "manufacturer": "C-Tech"
            }
          ]
        },
        "2": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m2-2-cutdown",
              "name": "Mn-0 Artemis cut down",
              "ei": 120,
              "notes": "Cut down Artemis 3. Stiffer aft than original b2 (EI approximate)",
              "length": "3015mm"
            },
            {
              "id": "gem-m2-2-triple",
              "name": "MN1 Super stiff triple red",
              "ei": 550,
              "notes": "1-2% target camber, 20kts + when no chance of setting main",
              "length": "3029mm",
              "serial": "52262",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-2-dbl",
              "name": "MN1 Stiff + double red",
              "ei": 149,
              "notes": "Good top end of J2/J3 when you are blowing out the main",
              "length": "3029mm",
              "serial": "52803",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-2-stiff",
              "name": "MN1 Stiff red",
              "ei": 87,
              "notes": "Good when you can keep main set",
              "length": "3029mm",
              "serial": "52247",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-2-soft",
              "name": "MN1 Soft green",
              "ei": 60,
              "notes": "Low end G1",
              "length": "3029mm",
              "serial": "52259",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-2-blue",
              "name": "Gemera MN1 Medium blue",
              "ei": 66,
              "notes": "Top end G1, low end J2",
              "length": "3029mm",
              "serial": "52253",
              "manufacturer": "C-Tech"
            }
          ]
        },
        "3": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m2-3-mn0",
              "name": "MN-0",
              "ei": 174,
              "notes": "",
              "length": "3595mm",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-3-dbl",
              "name": "MN1 Stiff + double red",
              "ei": 211,
              "notes": "Good top end of J2/J3 when you are blowing out the main",
              "length": "3600mm",
              "serial": "52748",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-3-rc44-94",
              "name": "RC44 B3 94",
              "ei": 94,
              "notes": "New batten too long",
              "length": "3600mm"
            },
            {
              "id": "gem-m2-3-rc44-180",
              "name": "RC44 B3 180",
              "ei": 180,
              "notes": "New batten too long",
              "length": "3600mm"
            },
            {
              "id": "gem-m2-3-rc44-240",
              "name": "RC44 B3 240",
              "ei": 240,
              "notes": "New batten too long",
              "length": "3600mm"
            },
            {
              "id": "gem-m2-3-blue",
              "name": "Gemera MN1 Medium blue",
              "ei": 125,
              "notes": "",
              "length": "3600mm",
              "serial": "52254",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-3-blue2",
              "name": "MN1 blue",
              "ei": 135,
              "notes": "",
              "length": "3600mm",
              "serial": "52248",
              "manufacturer": "C-Tech"
            }
          ]
        },
        "4": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m2-4-mn0",
              "name": "MN-0",
              "ei": 237,
              "notes": "",
              "length": "4110mm",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-4-med",
              "name": "MN2 med blue",
              "ei": 158,
              "notes": "",
              "length": "4108mm",
              "serial": "52255",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-4-rc44",
              "name": "RC44 B4 172",
              "ei": 172,
              "notes": "New batten too long",
              "length": "4252mm"
            }
          ]
        },
        "5": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m2-5-mn0",
              "name": "MN-0",
              "ei": 290,
              "notes": "",
              "length": "4619mm",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-5-rc44-210",
              "name": "RC44 B5 210",
              "ei": 206,
              "notes": "New batten too long",
              "length": "4758mm"
            },
            {
              "id": "gem-m2-5-rc44-300",
              "name": "RC44 B5 300",
              "ei": 297,
              "notes": "New batten too long",
              "length": "4758mm"
            },
            {
              "id": "gem-m2-5-med",
              "name": "MN1 med blue",
              "ei": 158,
              "notes": "",
              "length": "4630mm",
              "serial": "52256",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-5-stiff",
              "name": "MN1 Stiff red",
              "ei": 255,
              "notes": "",
              "length": "4630mm",
              "serial": "52250",
              "manufacturer": "C-Tech"
            }
          ]
        },
        "6": {
          "installed": null,
          "battens": [
            {
              "id": "gem-m2-6-mn0",
              "name": "MN-0",
              "ei": 294,
              "notes": "",
              "length": "5012mm",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-6-stiff",
              "name": "MN2 Stiff red",
              "ei": 320,
              "notes": "",
              "length": "5005mm",
              "serial": "52257",
              "manufacturer": "C-Tech"
            },
            {
              "id": "gem-m2-6-soft",
              "name": "Gemera MN1 Soft green",
              "ei": 220,
              "notes": "Only use down range G1, too round down low as soon as powered up",
              "length": "5027mm",
              "serial": "52260",
              "manufacturer": "C-Tech"
            }
          ]
        }
      }
    }
  }
};
