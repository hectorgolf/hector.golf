/**
 * Real course payloads, trimmed to what the CLI reads.
 *
 * Captured from the API: Tapiola and Hirsala are two-nine courses, Nevas has
 * three and publishes all nine pairings including the reversed ones.
 */

import type { Course } from "../../../src/code/mscorecard/types.ts";

export const TAPIOLA: Course = {
    "courseID": "0121371825104923099",
    "courseName": "18-hole course",
    "numHoles": 18,
    "numNines": 2,
    "nine1": 1,
    "nine2": 2,
    "club": {
        "name": "Tapiola Golf"
    },
    "parIndex_1_1": {
        "pars": [
            5,
            3,
            4,
            3,
            5,
            4,
            4,
            4,
            4,
            5,
            3,
            4,
            3,
            5,
            4,
            4,
            4,
            4
        ],
        "indexes": [
            13,
            17,
            11,
            7,
            5,
            9,
            3,
            15,
            1,
            14,
            18,
            12,
            8,
            6,
            10,
            4,
            16,
            2
        ]
    },
    "parIndex_1_2": {
        "pars": [
            5,
            3,
            4,
            3,
            5,
            4,
            4,
            4,
            4,
            4,
            5,
            4,
            3,
            4,
            4,
            4,
            4,
            4
        ],
        "indexes": [
            14,
            18,
            12,
            8,
            6,
            10,
            4,
            16,
            2,
            3,
            17,
            11,
            9,
            15,
            1,
            7,
            13,
            5
        ]
    },
    "parIndex_2_2": {
        "pars": [
            4,
            5,
            4,
            3,
            4,
            4,
            4,
            4,
            4,
            4,
            5,
            4,
            3,
            4,
            4,
            4,
            4,
            4
        ],
        "indexes": [
            3,
            17,
            11,
            9,
            15,
            1,
            7,
            13,
            5,
            4,
            18,
            12,
            10,
            16,
            2,
            8,
            14,
            6
        ]
    },
    "nine1Name": "",
    "nine2Name": "",
    "nine3Name": "",
    "nine4Name": "",
    "tees": [
        {
            "teeID": "207396",
            "extTeeID": 5,
            "name": "61",
            "teeColor": "#FFFFFF",
            "teeNum": 1,
            "lengths": [
                [
                    466,
                    144,
                    307,
                    187,
                    502,
                    324,
                    370,
                    280,
                    424
                ],
                [
                    403,
                    455,
                    309,
                    136,
                    321,
                    419,
                    426,
                    277,
                    365
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 127,
                "cr": 72.8,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_1_2": {
                "slope": 127,
                "cr": 72.8,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_2_2": {
                "slope": 127,
                "cr": 72.8,
                "slopeW": 0,
                "crW": 0
            }
        },
        {
            "teeID": "207397",
            "extTeeID": 4,
            "name": "57",
            "teeColor": "#FFFF00",
            "teeNum": 2,
            "lengths": [
                [
                    448,
                    112,
                    287,
                    167,
                    469,
                    312,
                    317,
                    268,
                    399
                ],
                [
                    375,
                    418,
                    293,
                    119,
                    292,
                    394,
                    394,
                    264,
                    342
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 123,
                "cr": 70.5,
                "slopeW": 135,
                "crW": 75.5
            },
            "ratings_1_2": {
                "slope": 123,
                "cr": 70.5,
                "slopeW": 135,
                "crW": 75.5
            },
            "ratings_2_2": {
                "slope": 123,
                "cr": 70.5,
                "slopeW": 135,
                "crW": 75.5
            }
        },
        {
            "teeID": "207398",
            "extTeeID": 3,
            "name": "52",
            "teeColor": "#00CCFF",
            "teeNum": 3,
            "lengths": [
                [
                    420,
                    91,
                    269,
                    129,
                    445,
                    274,
                    298,
                    244,
                    376
                ],
                [
                    341,
                    384,
                    267,
                    96,
                    272,
                    354,
                    354,
                    248,
                    303
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 118,
                "cr": 68.1,
                "slopeW": 128,
                "crW": 72.5
            },
            "ratings_1_2": {
                "slope": 118,
                "cr": 68.1,
                "slopeW": 128,
                "crW": 72.5
            },
            "ratings_2_2": {
                "slope": 118,
                "cr": 68.1,
                "slopeW": 128,
                "crW": 72.5
            }
        },
        {
            "teeID": "207399",
            "extTeeID": 2,
            "name": "46",
            "teeColor": "#FF5050",
            "teeNum": 4,
            "lengths": [
                [
                    369,
                    73,
                    251,
                    105,
                    407,
                    256,
                    260,
                    231,
                    339
                ],
                [
                    309,
                    350,
                    244,
                    78,
                    249,
                    333,
                    334,
                    190,
                    267
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 113,
                "cr": 65.5,
                "slopeW": 122,
                "crW": 69.3
            },
            "ratings_1_2": {
                "slope": 113,
                "cr": 65.5,
                "slopeW": 122,
                "crW": 69.3
            },
            "ratings_2_2": {
                "slope": 113,
                "cr": 65.5,
                "slopeW": 122,
                "crW": 69.3
            }
        },
        {
            "teeID": "220579",
            "extTeeID": 6,
            "name": "35",
            "teeColor": "#FFFFFE",
            "teeNum": 5,
            "lengths": [
                [
                    270,
                    68,
                    205,
                    94,
                    260,
                    200,
                    153,
                    180,
                    255
                ],
                [
                    204,
                    248,
                    209,
                    75,
                    207,
                    220,
                    219,
                    190,
                    231
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 101,
                "cr": 59.7,
                "slopeW": 107,
                "crW": 62.2
            },
            "ratings_1_2": {
                "slope": 101,
                "cr": 59.7,
                "slopeW": 107,
                "crW": 62.2
            },
            "ratings_2_2": {
                "slope": 101,
                "cr": 59.7,
                "slopeW": 107,
                "crW": 62.2
            }
        }
    ]
} as unknown as Course;

export const HIRSALA: Course = {
    "courseID": "0121568050825406011",
    "courseName": "18-hole course",
    "numHoles": 18,
    "numNines": 2,
    "nine1": 1,
    "nine2": 2,
    "club": {
        "name": "Hirsala Golf"
    },
    "parIndex_1_1": {
        "pars": [
            4,
            3,
            4,
            5,
            4,
            4,
            4,
            3,
            5,
            4,
            3,
            4,
            5,
            4,
            4,
            4,
            3,
            5
        ],
        "indexes": [
            5,
            17,
            9,
            13,
            11,
            3,
            7,
            15,
            1,
            6,
            18,
            10,
            14,
            12,
            4,
            8,
            16,
            2
        ]
    },
    "parIndex_1_2": {
        "pars": [
            4,
            3,
            4,
            5,
            4,
            4,
            4,
            3,
            5,
            4,
            4,
            5,
            4,
            3,
            5,
            3,
            4,
            5
        ],
        "indexes": [
            6,
            18,
            10,
            14,
            12,
            4,
            8,
            16,
            2,
            13,
            3,
            15,
            5,
            17,
            7,
            11,
            1,
            9
        ]
    },
    "parIndex_2_2": {
        "pars": [
            4,
            4,
            5,
            4,
            3,
            5,
            3,
            4,
            5,
            4,
            4,
            5,
            4,
            3,
            5,
            3,
            4,
            5
        ],
        "indexes": [
            13,
            3,
            15,
            5,
            17,
            7,
            11,
            1,
            9,
            14,
            4,
            16,
            6,
            18,
            8,
            12,
            2,
            10
        ]
    },
    "nine1Name": "",
    "nine2Name": "",
    "nine3Name": "",
    "nine4Name": "",
    "tees": [
        {
            "teeID": "221969",
            "extTeeID": 7,
            "name": "Musta",
            "teeColor": "#999999",
            "teeNum": 6,
            "lengths": [
                [
                    380,
                    128,
                    352,
                    490,
                    381,
                    370,
                    353,
                    180,
                    510
                ],
                [
                    291,
                    380,
                    454,
                    396,
                    179,
                    502,
                    159,
                    404,
                    437
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 135,
                "cr": 74.6,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_1_2": {
                "slope": 135,
                "cr": 74.6,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_2_2": {
                "slope": 135,
                "cr": 74.6,
                "slopeW": 0,
                "crW": 0
            }
        },
        {
            "teeID": "208146",
            "extTeeID": 5,
            "name": "Valkoinen",
            "teeColor": "#FFFFFF",
            "teeNum": 1,
            "lengths": [
                [
                    354,
                    120,
                    352,
                    478,
                    356,
                    331,
                    326,
                    164,
                    486
                ],
                [
                    285,
                    345,
                    430,
                    380,
                    158,
                    465,
                    130,
                    377,
                    420
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 131,
                "cr": 72.6,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_1_2": {
                "slope": 131,
                "cr": 72.6,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_2_2": {
                "slope": 131,
                "cr": 72.6,
                "slopeW": 0,
                "crW": 0
            }
        },
        {
            "teeID": "208147",
            "extTeeID": 4,
            "name": "Keltainen",
            "teeColor": "#FFFF00",
            "teeNum": 2,
            "lengths": [
                [
                    330,
                    109,
                    324,
                    438,
                    328,
                    312,
                    315,
                    142,
                    476
                ],
                [
                    274,
                    330,
                    415,
                    347,
                    135,
                    447,
                    124,
                    360,
                    390
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 127,
                "cr": 70.8,
                "slopeW": 132,
                "crW": 76.8
            },
            "ratings_1_2": {
                "slope": 127,
                "cr": 70.8,
                "slopeW": 132,
                "crW": 76.8
            },
            "ratings_2_2": {
                "slope": 127,
                "cr": 70.8,
                "slopeW": 132,
                "crW": 76.8
            }
        },
        {
            "teeID": "208148",
            "extTeeID": 3,
            "name": "Sininen",
            "teeColor": "#00CCFF",
            "teeNum": 3,
            "lengths": [
                [
                    294,
                    109,
                    305,
                    410,
                    328,
                    292,
                    303,
                    126,
                    395
                ],
                [
                    262,
                    310,
                    351,
                    302,
                    120,
                    398,
                    113,
                    334,
                    368
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 122,
                "cr": 68.5,
                "slopeW": 126,
                "crW": 73.9
            },
            "ratings_1_2": {
                "slope": 122,
                "cr": 68.5,
                "slopeW": 126,
                "crW": 73.9
            },
            "ratings_2_2": {
                "slope": 122,
                "cr": 68.5,
                "slopeW": 126,
                "crW": 73.9
            }
        },
        {
            "teeID": "208149",
            "extTeeID": 2,
            "name": "Punainen",
            "teeColor": "#FF5050",
            "teeNum": 4,
            "lengths": [
                [
                    260,
                    98,
                    280,
                    375,
                    296,
                    273,
                    262,
                    92,
                    355
                ],
                [
                    246,
                    290,
                    324,
                    272,
                    100,
                    335,
                    90,
                    292,
                    308
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 117,
                "cr": 65.6,
                "slopeW": 119,
                "crW": 70.4
            },
            "ratings_1_2": {
                "slope": 117,
                "cr": 65.6,
                "slopeW": 119,
                "crW": 70.4
            },
            "ratings_2_2": {
                "slope": 117,
                "cr": 65.6,
                "slopeW": 119,
                "crW": 70.4
            }
        },
        {
            "teeID": "208150",
            "extTeeID": 6,
            "name": "Ilves",
            "teeColor": "#FFFFFE",
            "teeNum": 5,
            "lengths": [
                [
                    150,
                    98,
                    150,
                    200,
                    150,
                    150,
                    150,
                    92,
                    200
                ],
                [
                    150,
                    150,
                    200,
                    150,
                    100,
                    200,
                    90,
                    150,
                    200
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 104,
                "cr": 59.6,
                "slopeW": 98,
                "crW": 60.4
            },
            "ratings_1_2": {
                "slope": 104,
                "cr": 59.6,
                "slopeW": 98,
                "crW": 60.4
            },
            "ratings_2_2": {
                "slope": 104,
                "cr": 59.6,
                "slopeW": 98,
                "crW": 60.4
            }
        }
    ]
} as unknown as Course;

export const NEVAS: Course = {
    "courseID": "0231184662556869",
    "courseName": "Karppi + Rapu",
    "numHoles": 27,
    "numNines": 3,
    "nine1": 2,
    "nine2": 3,
    "club": {
        "name": "Nevas Golf"
    },
    "parIndex_1_1": {
        "pars": [
            4,
            3,
            4,
            4,
            4,
            4,
            4,
            3,
            5,
            4,
            3,
            4,
            4,
            4,
            4,
            4,
            3,
            5
        ],
        "indexes": [
            7,
            15,
            9,
            3,
            11,
            5,
            13,
            17,
            1,
            8,
            16,
            10,
            4,
            12,
            6,
            14,
            18,
            2
        ]
    },
    "parIndex_1_2": {
        "pars": [
            4,
            3,
            4,
            4,
            4,
            4,
            4,
            3,
            5,
            3,
            4,
            4,
            4,
            5,
            5,
            4,
            3,
            4
        ],
        "indexes": [
            7,
            15,
            9,
            3,
            11,
            5,
            13,
            17,
            1,
            14,
            4,
            12,
            6,
            2,
            8,
            18,
            16,
            10
        ]
    },
    "parIndex_1_3": {
        "pars": [
            4,
            3,
            4,
            4,
            4,
            4,
            4,
            3,
            5,
            4,
            3,
            4,
            5,
            3,
            4,
            4,
            5,
            4
        ],
        "indexes": [
            7,
            15,
            9,
            3,
            11,
            5,
            13,
            17,
            1,
            14,
            10,
            4,
            2,
            18,
            16,
            6,
            8,
            12
        ]
    },
    "parIndex_2_1": {
        "pars": [
            3,
            4,
            4,
            4,
            5,
            5,
            4,
            3,
            4,
            4,
            3,
            4,
            4,
            4,
            4,
            4,
            3,
            5
        ],
        "indexes": [
            13,
            3,
            11,
            5,
            1,
            7,
            17,
            15,
            9,
            8,
            16,
            10,
            4,
            12,
            6,
            14,
            18,
            2
        ]
    },
    "parIndex_2_2": {
        "pars": [
            3,
            4,
            4,
            4,
            5,
            5,
            4,
            3,
            4,
            3,
            4,
            4,
            4,
            5,
            5,
            4,
            3,
            4
        ],
        "indexes": [
            13,
            3,
            11,
            5,
            1,
            7,
            17,
            15,
            9,
            14,
            4,
            12,
            6,
            2,
            8,
            18,
            16,
            10
        ]
    },
    "parIndex_2_3": {
        "pars": [
            3,
            4,
            4,
            4,
            5,
            5,
            4,
            3,
            4,
            4,
            3,
            4,
            5,
            3,
            4,
            4,
            5,
            4
        ],
        "indexes": [
            13,
            3,
            11,
            5,
            1,
            7,
            17,
            15,
            9,
            14,
            10,
            4,
            2,
            18,
            16,
            6,
            8,
            12
        ]
    },
    "parIndex_3_1": {
        "pars": [
            4,
            3,
            4,
            5,
            3,
            4,
            4,
            5,
            4,
            4,
            3,
            4,
            4,
            4,
            4,
            4,
            3,
            5
        ],
        "indexes": [
            13,
            9,
            3,
            1,
            17,
            15,
            5,
            7,
            11,
            8,
            16,
            10,
            4,
            12,
            6,
            14,
            18,
            2
        ]
    },
    "parIndex_3_2": {
        "pars": [
            4,
            3,
            4,
            5,
            3,
            4,
            4,
            5,
            4,
            3,
            4,
            4,
            4,
            5,
            5,
            4,
            3,
            4
        ],
        "indexes": [
            13,
            9,
            3,
            1,
            17,
            15,
            5,
            7,
            11,
            14,
            4,
            12,
            6,
            2,
            8,
            18,
            16,
            10
        ]
    },
    "parIndex_3_3": {
        "pars": [
            4,
            3,
            4,
            5,
            3,
            4,
            4,
            5,
            4,
            4,
            3,
            4,
            5,
            3,
            4,
            4,
            5,
            4
        ],
        "indexes": [
            13,
            9,
            3,
            1,
            17,
            15,
            5,
            7,
            11,
            14,
            10,
            4,
            2,
            18,
            16,
            6,
            8,
            12
        ]
    },
    "nine1Name": "Kettu",
    "nine2Name": "Karppi",
    "nine3Name": "Rapu",
    "nine4Name": "",
    "tees": [
        {
            "teeID": "21711",
            "extTeeID": 5,
            "name": "Valkoinen",
            "teeColor": "#FFFFFF",
            "teeNum": 1,
            "lengths": [
                [
                    310,
                    160,
                    315,
                    320,
                    325,
                    340,
                    315,
                    135,
                    495
                ],
                [
                    148,
                    395,
                    321,
                    340,
                    465,
                    460,
                    267,
                    170,
                    330
                ],
                [
                    330,
                    188,
                    337,
                    529,
                    130,
                    300,
                    346,
                    451,
                    296
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 135,
                "cr": 69.4,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_1_2": {
                "slope": 138,
                "cr": 70.6,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_1_3": {
                "slope": 136,
                "cr": 70.9,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_2_1": {
                "slope": 138,
                "cr": 70.6,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_2_2": {
                "slope": 140,
                "cr": 71.7,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_2_3": {
                "slope": 138,
                "cr": 72,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_3_1": {
                "slope": 136,
                "cr": 70.9,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_3_2": {
                "slope": 138,
                "cr": 72,
                "slopeW": 0,
                "crW": 0
            },
            "ratings_3_3": {
                "slope": 136,
                "cr": 72.3,
                "slopeW": 0,
                "crW": 0
            }
        },
        {
            "teeID": "64702",
            "extTeeID": 4,
            "name": "Keltainen",
            "teeColor": "#FFFF00",
            "teeNum": 2,
            "lengths": [
                [
                    280,
                    155,
                    310,
                    318,
                    320,
                    314,
                    305,
                    125,
                    490
                ],
                [
                    136,
                    350,
                    296,
                    330,
                    465,
                    445,
                    257,
                    160,
                    320
                ],
                [
                    317,
                    150,
                    320,
                    512,
                    15,
                    290,
                    327,
                    438,
                    282
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 133,
                "cr": 68.4,
                "slopeW": 139,
                "crW": 73.7
            },
            "ratings_1_2": {
                "slope": 135,
                "cr": 69.1,
                "slopeW": 141,
                "crW": 74.8
            },
            "ratings_1_3": {
                "slope": 133,
                "cr": 69.6,
                "slopeW": 139,
                "crW": 75.2
            },
            "ratings_2_1": {
                "slope": 135,
                "cr": 69.1,
                "slopeW": 141,
                "crW": 74.8
            },
            "ratings_2_2": {
                "slope": 137,
                "cr": 69.7,
                "slopeW": 143,
                "crW": 75.8
            },
            "ratings_2_3": {
                "slope": 135,
                "cr": 70.2,
                "slopeW": 141,
                "crW": 76.2
            },
            "ratings_3_1": {
                "slope": 133,
                "cr": 69.6,
                "slopeW": 139,
                "crW": 75.2
            },
            "ratings_3_2": {
                "slope": 135,
                "cr": 70.2,
                "slopeW": 141,
                "crW": 76.2
            },
            "ratings_3_3": {
                "slope": 132,
                "cr": 70.7,
                "slopeW": 138,
                "crW": 76.6
            }
        },
        {
            "teeID": "21713",
            "extTeeID": 3,
            "name": "Sininen",
            "teeColor": "#00CCFF",
            "teeNum": 3,
            "lengths": [
                [
                    240,
                    145,
                    310,
                    300,
                    280,
                    301,
                    300,
                    120,
                    420
                ],
                [
                    102,
                    350,
                    296,
                    325,
                    460,
                    435,
                    247,
                    155,
                    315
                ],
                [
                    290,
                    135,
                    290,
                    440,
                    105,
                    280,
                    290,
                    435,
                    265
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 129,
                "cr": 66.4,
                "slopeW": 134,
                "crW": 71.2
            },
            "ratings_1_2": {
                "slope": 133,
                "cr": 67.7,
                "slopeW": 138,
                "crW": 73.1
            },
            "ratings_1_3": {
                "slope": 129,
                "cr": 67.5,
                "slopeW": 133,
                "crW": 72.6
            },
            "ratings_2_1": {
                "slope": 133,
                "cr": 67.7,
                "slopeW": 138,
                "crW": 73.1
            },
            "ratings_2_2": {
                "slope": 136,
                "cr": 69,
                "slopeW": 141,
                "crW": 74.9
            },
            "ratings_2_3": {
                "slope": 132,
                "cr": 68.8,
                "slopeW": 137,
                "crW": 74.4
            },
            "ratings_3_1": {
                "slope": 129,
                "cr": 67.5,
                "slopeW": 133,
                "crW": 72.6
            },
            "ratings_3_2": {
                "slope": 132,
                "cr": 68.8,
                "slopeW": 137,
                "crW": 74.4
            },
            "ratings_3_3": {
                "slope": 128,
                "cr": 68.5,
                "slopeW": 132,
                "crW": 73.9
            }
        },
        {
            "teeID": "21714",
            "extTeeID": 2,
            "name": "Punainen",
            "teeColor": "#FF5050",
            "teeNum": 4,
            "lengths": [
                [
                    240,
                    145,
                    240,
                    262,
                    225,
                    261,
                    275,
                    120,
                    410
                ],
                [
                    97,
                    295,
                    283,
                    295,
                    410,
                    385,
                    247,
                    130,
                    275
                ],
                [
                    282,
                    127,
                    280,
                    437,
                    100,
                    225,
                    280,
                    363,
                    258
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 124,
                "cr": 64.1,
                "slopeW": 128,
                "crW": 68.3
            },
            "ratings_1_2": {
                "slope": 127,
                "cr": 65.2,
                "slopeW": 131,
                "crW": 70
            },
            "ratings_1_3": {
                "slope": 124,
                "cr": 65.5,
                "slopeW": 128,
                "crW": 70
            },
            "ratings_2_1": {
                "slope": 127,
                "cr": 65.2,
                "slopeW": 131,
                "crW": 70
            },
            "ratings_2_2": {
                "slope": 130,
                "cr": 66.3,
                "slopeW": 134,
                "crW": 71.7
            },
            "ratings_2_3": {
                "slope": 127,
                "cr": 66.6,
                "slopeW": 131,
                "crW": 71.7
            },
            "ratings_3_1": {
                "slope": 124,
                "cr": 65.5,
                "slopeW": 128,
                "crW": 70
            },
            "ratings_3_2": {
                "slope": 127,
                "cr": 66.6,
                "slopeW": 131,
                "crW": 71.7
            },
            "ratings_3_3": {
                "slope": 124,
                "cr": 66.8,
                "slopeW": 128,
                "crW": 71.7
            }
        },
        {
            "teeID": "220961",
            "extTeeID": 6,
            "name": "Oranssi",
            "teeColor": "#FFA43D",
            "teeNum": 5,
            "lengths": [
                [
                    245,
                    140,
                    190,
                    192,
                    135,
                    201,
                    210,
                    115,
                    370
                ],
                [
                    92,
                    225,
                    208,
                    248,
                    368,
                    315,
                    235,
                    128,
                    195
                ],
                [
                    197,
                    122,
                    144,
                    297,
                    97,
                    175,
                    240,
                    303,
                    223
                ],
                [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                ]
            ],
            "ratings_1_1": {
                "slope": 116,
                "cr": 60.3,
                "slopeW": 118,
                "crW": 63.7
            },
            "ratings_1_2": {
                "slope": 121,
                "cr": 61.7,
                "slopeW": 122,
                "crW": 65.5
            },
            "ratings_1_3": {
                "slope": 115,
                "cr": 60.8,
                "slopeW": 116,
                "crW": 64.4
            },
            "ratings_2_1": {
                "slope": 121,
                "cr": 61.7,
                "slopeW": 122,
                "crW": 65.5
            },
            "ratings_2_2": {
                "slope": 125,
                "cr": 63,
                "slopeW": 125,
                "crW": 67.2
            },
            "ratings_2_3": {
                "slope": 119,
                "cr": 62.2,
                "slopeW": 120,
                "crW": 66.1
            },
            "ratings_3_1": {
                "slope": 115,
                "cr": 60.8,
                "slopeW": 116,
                "crW": 64.4
            },
            "ratings_3_2": {
                "slope": 119,
                "cr": 62.2,
                "slopeW": 120,
                "crW": 66.1
            },
            "ratings_3_3": {
                "slope": 113,
                "cr": 61.3,
                "slopeW": 114,
                "crW": 65
            }
        }
    ]
} as unknown as Course;
