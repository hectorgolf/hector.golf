# Reverse engineering mScorecard app's backend API

## Authentication and general usage

mScorecard exposes two backends, and a client needs both:

| | Base URL | Auth | Content type |
| --- | --- | --- | --- |
| Modern REST API | `https://www.mscorecard.com/api/v2.3` | `Authorization: Bearer <accessToken>` | `application/json` |
| Legacy PHP endpoints | `https://www.mscorecard.com/mscorecardx/m` | `email` + `password` form fields | `application/x-www-form-urlencoded` |

Courses and rounds live on the v2.3 API. The player roster and friend search are
only available on the legacy endpoints. A single login gives you credentials for
both.

### Logging in

```shell
curl 'https://www.mscorecard.com/api/v2.3/auth/login' \
  -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{"email":"<email>","password":"<password>","returnToken":1}'
```

The response carries two different credentials — `accessToken` for the v2.3 API
and `token` for the legacy endpoints:

```json
{
    "email":"<email address>",
    "country":"fi",
    "userID":"123456",
    "personID":"78901234",
    "token":"<tokenized password>",
    "accessToken":"<access token>",
    "UUID":"",
    "msg":"",
    "numCourses":44089,
    "numRounds":"7"
}
```

`returnToken: 1` is what makes the server include `token`. Hold on to `userID`
too — it identifies the account that owns any roster entries and rounds you
create.

### Calling the v2.3 API

Bearer token, JSON in and out:

```shell
curl 'https://www.mscorecard.com/api/v2.3/courses/<courseID>?app=1' \
    -H 'Authorization: Bearer <accessToken>' \
    -H 'Content-Type: application/json'
```

The `app=1` query parameter appears on every read the app makes. Responses set
`access-control-allow-origin: *` and preflights permit `GET, POST, PUT, DELETE,
PATCH` with an `authorization` header, so this API is reachable straight from a
browser.

### The access token rotates

**Any v2.3 response may carry a fresh `accessToken`, and when it does the previous
one stops working.** In the captures, the hole-1 `PATCH` responded with

```json
{"accessToken":"fUbKQhW7Urt3…","ts":"1788647977927609"}
```

and the hole-2 `PATCH` had to authenticate with that new value. A client must
therefore treat the token as mutable state and write it back after *every*
request:

```javascript
const body = await response.json()
if (body.accessToken) this.accessToken = body.accessToken
```

Skipping this is the most likely cause of an unexplained `401` partway through a
round. Note that rotation is silent — nothing in the response says the old token
was invalidated.
### Calling the legacy PHP endpoints

Form-encoded, and the `password` field takes the **hashed `token`** from the login
response, never the plaintext password:

```shell
curl -X POST 'https://www.mscorecard.com/mscorecardx/m/syncplayers.php' \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  --data-raw 'email=<URI-encoded email>&password=<token>&versionNumber=9110&download=1&players=&timestamp=1788643803329'
```

Every legacy call carries the same four fields — `email`, `password`,
`versionNumber` (`9110` in these captures), and `timestamp` (`Date.now()`) —
plus whatever is specific to the endpoint. These return bare JSON arrays and do
not rotate anything.

## Searching for courses by name

```shell
curl \
    'https://www.mscorecard.com/api/v2.3/courses?name=La%20Finca&country=&lat=&lng=&measure=1&app=1&_=1788640861689' \
    -H 'Authorization: Bearer <access token>' \
    -H 'Content-Type: application/json'
```

The response is a JSON document that looks like this:

```json
{
    "courses": [
        {
            "clubName": "La Finca Golf",
            "city": "Algorfa",
            "state": "Comunidad Valenciana",
            "country": "Spain",
            "country2": "",
            "latitude": "38.0584935",
            "longitude": "-0.7972078",
            "distance": "",
            "courseID": "0121202572522789",
            "courseName": "Championship course",
            "numHoles": 18,
            "gps": 1,
            "numCourses": 44089
        }
    ],
    "accessToken": "<access token>"
}
```

Extracting the course IDs (`0121202572522789` in the above example) from this
JSON document allows us to fetch more detailed data about specific courses:

## Getting a course's details

```shell
curl \
    -X GET \
    -H 'Content-type: application/json' \
    -H 'Authorization: Bearer <access token from login response>' \
    'https://www.mscorecard.com/api/v2.3/courses/<course id from course search response>?app=1'
```

The response for La Finca in Algorfa, Spain looks like this:

```json
{
    "course": {
        "club": {
            "name": "La Finca Golf",
            "address": "Avda. Antonio Pedrera Soler",
            "state": "Comunidad Valenciana",
            "postalCode": "03169",
            "city": "Algorfa",
            "country": "Spain",
            "latitude": "38.0584935",
            "longitude": "-0.7972078",
            "phone": "+34 966 72 90 10",
            "website": "https://www.lafincaresort.com/golf/la-finca-golf"
        },
        "formatVersion": "9",
        "courseID": "0121202572522789",
        "status": "2",
        "gps": 1,
        "numHoles": 18,
        "numNines": 2,
        "measure": 1,
        "nine1": 1,
        "nine2": 2,
        "nine1Name": "",
        "nine2Name": "",
        "nine3Name": "",
        "nine4Name": "",
        "courseName": "Championship course",
        "courseBaseName": "Championship course",
        "courseType": "1",
        "tees": [
            {
                "teeID": "209996",
                "extTeeID": 0,
                "name": "Blancas",
                "color": "16777215",
                "teeColor": "#FFFFFF",
                "teeNum": 1,
                "lengths": [
                    [ 525, 368, 168, 362, 535, 179, 434, 338, 474 ],
                    [ 305, 490, 375, 167, 396, 366, 162, 323, 427 ],
                    [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
                    [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ]
                ],
                "ratings_1_1": {
                    "slope": 145,
                    "cr": 76.2,
                    "slopeW": 0,
                    "crW": 0
                },
                "ratings_1_2": {
                    "slope": 139,
                    "cr": 74.6,
                    "slopeW": 0,
                    "crW": 0
                },
                "ratings_2_2": {
                    "slope": 132,
                    "cr": 73,
                    "slopeW": 0,
                    "crW": 0
                }
            },
            {
                "teeID": "209997",
                "extTeeID": 0,
                "name": "Amarillas",
                "color": "16776960",
                "teeColor": "#FFFF00",
                "teeNum": 2,
                "lengths": [
                    [ 499, 358, 157, 344, 514, 160, 404, 305, 454 ],
                    [ 299, 470, 344, 148, 372, 340, 157, 313, 394 ],
                    [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
                    [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ]
                ],
                "ratings_1_1": {
                    "slope": 140,
                    "cr": 74.6,
                    "slopeW": 0,
                    "crW": 0
                },
                "ratings_1_2": {
                    "slope": 133,
                    "cr": 72.7,
                    "slopeW": 0,
                    "crW": 0
                },
                "ratings_2_2": {
                    "slope": 126,
                    "cr": 70.8,
                    "slopeW": 0,
                    "crW": 0
                }
            },
            {
                "teeID": "209998",
                "extTeeID": 0,
                "name": "Azules",
                "color": "52479",
                "teeColor": "#00CCFF",
                "teeNum": 3,
                "lengths": [
                    [ 487, 334, 145, 333, 507, 153, 352, 288, 444 ],
                    [ 282, 465, 340, 128, 354, 333, 119, 307, 366 ],
                    [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
                    [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ]
                ],
                "ratings_1_1": {
                    "slope": 130,
                    "cr": 72.4,
                    "slopeW": 140,
                    "crW": 79.8
                },
                "ratings_1_2": {
                    "slope": 124,
                    "cr": 70.9,
                    "slopeW": 140,
                    "crW": 77.5
                },
                "ratings_2_2": {
                    "slope": 117,
                    "cr": 69.4,
                    "slopeW": 140,
                    "crW": 75.2
                }
            },
            {
                "teeID": "209999",
                "extTeeID": 0,
                "name": "Rojas",
                "color": "16732240",
                "teeColor": "#FF5050",
                "teeNum": 4,
                "lengths": [
                    [ 484, 298, 125, 315, 479, 139, 349, 269, 430 ],
                    [ 264, 437, 300, 118, 330, 315, 113, 289, 357 ],
                    [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
                    [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ]
                ],
                "ratings_1_1": {
                    "slope": 123,
                    "cr": 70.8,
                    "slopeW": 142,
                    "crW": 77.4
                },
                "ratings_1_2": {
                    "slope": 123,
                    "cr": 69.1,
                    "slopeW": 139,
                    "crW": 75.3
                },
                "ratings_2_2": {
                    "slope": 123,
                    "cr": 67.4,
                    "slopeW": 136,
                    "crW": 73.2
                }
            },
            {
                "teeID": "230462",
                "extTeeID": 0,
                "name": "Orange",
                "color": "16753725",
                "teeColor": "#FFA43D",
                "teeNum": 5,
                "lengths": [
                    [ 430, 292, 121, 253, 435, 101, 268, 265, 388 ],
                    [ 220, 372, 273, 108, 269, 270, 108, 264, 304 ],
                    [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
                    [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ]
                ],
                "ratings_1_1": {
                    "slope": 121,
                    "cr": 67.4,
                    "slopeW": 138,
                    "crW": 72.8
                },
                "ratings_1_2": {
                    "slope": 118,
                    "cr": 65,
                    "slopeW": 130,
                    "crW": 70.5
                },
                "ratings_2_2": {
                    "slope": 115,
                    "cr": 62.6,
                    "slopeW": 122,
                    "crW": 68.2
                }
            }
        ],
        "parIndex_1_1": {
            "indexes": [ 11, 5, 9, 13, 3, 7, 1, 15, 17, 12, 6, 10, 14, 4, 8, 2, 16, 18 ],
            "pars": [ 5, 4, 3, 4, 5, 3, 4, 4, 5, 5, 4, 3, 4, 5, 3, 4, 4, 5 ]
        },
        "parIndex_1_2": {
            "indexes": [ 11, 5, 9, 13, 3, 7, 1, 15, 17, 6, 16, 14, 18, 10, 8, 12, 2, 4 ],
            "pars": [ 5, 4, 3, 4, 5, 3, 4, 4, 5, 4, 5, 4, 3, 4, 4, 3, 4, 4 ]
        },
        "parIndex_2_2": {
            "indexes": [ 5, 15, 13, 17, 9, 7, 11, 1, 3, 6, 16, 14, 18, 10, 8, 12, 2, 4 ],
            "pars": [ 4, 5, 4, 3, 4, 4, 3, 4, 4, 4, 5, 4, 3, 4, 4, 3, 4, 4 ]
        },
        "coordinatesNines": [
            {
                "poi": 1,
                "location": 3,
                "sideFW": 2,
                "hole": 1,
                "latitude": 38.0581418,
                "longitude": -0.7910101,
                "isUpdated": null,
                "deleted": 0,
                "nineNum": 1
            },
            {
                "poi": 1,
                "location": 2,
                "sideFW": 2,
                "hole": 1,
                "latitude": 38.0581012,
                "longitude": -0.7912369,
                "isUpdated": null,
                "deleted": 0,
                "nineNum": 1
            },
            {
                "poi": 1,
                "location": 1,
                "sideFW": 2,
                "hole": 1,
                "latitude": 38.058039,
                "longitude": -0.791481,
                "isUpdated": null,
                "deleted": 0,
                "nineNum": 1
            }
        ]
    }
}
```

## Look up players by name

```shell
curl -X POST 'https://www.mscorecard.com/mscorecardx/m/findFriends.php' \
    -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
    -H 'Content-Length: 176' \
    --data-raw 'email=<URI-encoded email>&password=<token>&versionNumber=9110&searchString=Toni+Marttila&timestamp=17886458770002'
```

And resulting response payload is:

```json
[
    {
        "FirstName":"Toni",
        "LastName":"Marttila",
        "City":"",
        "State":"",
        "Country":"Finland",
        "Photo":"",
        "Name":"Toni Marttila",
        "ShortName":"TM",
        "Club":"",
        "Hcp":36,
        "Gender":1,
        "Email":"",
        "ID":"207653",
        "PID":"1788645892735896",
        "FriendStatus":"1"
    }
]
```


Download all friends:

```shell
curl 'https://www.mscorecard.com/mscorecardx/m/syncplayers.php' \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H 'Content-Length: 168' \
  -X POST \
  --data-raw 'email=user.name%40gmail.com&password=PASSWORD_TOKEN_GOES_HERE&versionNumber=9110&download=1&players=&timestamp=1788643803329'
```

which returns the following JSON:

```json
[
    {
        "name":"John Doe",
        "playerID":"1111222233334444",
        "shortName":"JD",
        "friendUserID":"0",
        "friendPlayerID":"",
        "friendStatus":"0",
        "friendCopyData":"0",
        "email":"<email address>",
        "photo":"123456_1234123412341234",
        "gender":"1",
        "hcp":14.8,
        "hcpType":"9",
        "club":"",
        "memberNumber":"",
        "rounds":7,
        "numRounds":7,
        "isDefaultPlayer":1,
        "numFriendRequests":0
    },
    {
        "name":"Lotta Golf",
        "playerID":"1212232334345",
        "shortName":"LG",
        "friendUserID":"0",
        "friendPlayerID":"",
        "friendStatus":"0",
        "friendCopyData":"0",
        "email":"",
        "photo":"",
        "gender":"0",
        "hcp":54,
        "hcpType":"9",
        "club":"",
        "memberNumber":"",
        "rounds":3,
        "numRounds":3,
        "isDefaultPlayer":0
    }
]
```

## Create a round in a player's mscorecard profile

```shell
curl -X PUT 'https://www.mscorecard.com/api/v2.3/rounds/<round ID>' \
    -H 'Authorization: Bearer <access token>' \
    -H 'Content-Type: application/json' \
    --raw-data '{"ts": "1788645090279736", "submitHcpRound": 0, "round": { "roundID": "1788643812694", "courseID": "0121371825104923099", "nine1": 1, "nine2": 2, "courseChanged": 0, "date": "202609060000", "hcpRoundSubmitted": "0", "numGroups": 1, "numPlayers": 2, "markerName": "", "finished": "1", "noNotifications": 1, "competitionName": "", "userID": "694833", "scores": [], "scoresDeleted": [], "modifiedFields": [], "showAdjustedScore": 0, "gameFormat": 1}}'
```

Game format IDs:

- 0 is Stroke Play
- 1 is Stroke Play NET
- 2 is Stableford

The format decides only how a card is presented and totalled; the strokes are the
same either way, and it can be changed on an existing round.


### `nine1` and `nine2` select which nines are played

These are **nine indexes, not booleans**. `nine1` is the nine played on the front
half of the card and `nine2` the one played on the back half; `nine2: 0` means a
nine-hole round. Values of `2` are ordinary — the captures contain both:

```text
round 1788616184998   nine1: 1, nine2: 2    18 holes, the standard routing
round 1788617932718   nine1: 1, nine2: 2
round 1788643812694   nine1: 1, nine2: 2
round 1788647732160   nine1: 1, nine2: 0    9 holes, front nine only
```

A course carries `numNines` and names up to four of them (`nine1Name` …
`nine4Name`), and each tee's `lengths` is an array of four per-nine arrays, so the
index can in principle go up to 4 on a facility with that many nines.

The tee ratings and par tables confirm the reading, because they are keyed by the
`<nine1>_<nine2>` pair. Hirsala's 18-hole course offers exactly three
combinations:

| Key | Meaning |
| --- | --- |
| `ratings_1_1` / `parIndex_1_1` | nine 1 twice |
| `ratings_1_2` / `parIndex_1_2` | nine 1 then nine 2 — the standard 18 |
| `ratings_2_2` / `parIndex_2_2` | nine 2 twice |

And the par arrays are exactly what those names predict:

```text
parIndex_1_1  front [4,3,4,5,4,4,4,3,5]  back [4,3,4,5,4,4,4,3,5]   identical halves
parIndex_1_2  front [4,3,4,5,4,4,4,3,5]  back [4,4,5,4,3,5,3,4,5]   two different nines
parIndex_2_2  front [4,4,5,4,3,5,3,4,5]  back [4,4,5,4,3,5,3,4,5]   identical halves
```

So `nine1: 2, nine2: 2` is a legitimate combination the course data explicitly
rates, even though no captured round uses it.

On a two-nine course the keys only ever appear in ascending order — Hirsala has no
`ratings_2_1`. That is **not** a constraint on the round, just an economy: a rating
depends on which eighteen holes you play, not the order, so one key per unordered
pair suffices. Starting on the back nine and finishing on the front — an ordinary
crossover start — is `nine1: 2, nine2: 1`, and it borrows the `_1_2` rating.

A three-nine course proves the point by publishing the reversed keys outright.
Nevas Golf (`0121184662556869`, nines Kettu / Karppi / Rapu) carries all nine
combinations on both the course and every tee:

```text
parIndex_1_1  parIndex_1_2  parIndex_1_3
parIndex_2_1  parIndex_2_2  parIndex_2_3
parIndex_3_1  parIndex_3_2  parIndex_3_3
```

The reversed pairs are identical in value to their ascending twins — off the
Valkoinen tees both `ratings_1_2` and `ratings_2_1` are slope 138, CR 70.6 — which
is why a two-nine course can get away with publishing only one of them.

What the order *does* change is the scorecard. `parIndex_2_1` lists Karppi's pars
first and Kettu's second, the exact mirror of `parIndex_1_2`. So the reliable way
to build a card for any ordering is to compose it from the single nines — a nine's
own `_N_N` table holds its pars twice, so the first nine entries are that nine —
and concatenate them in the order actually played. Slicing a mixed table gives the
wrong half whenever the round runs in descending order.

Reversed play is therefore documented in the course data; what remains uncaptured
is a *round* payload with `nine1 > nine2`.

The course object's own `nine1`/`nine2` fields are a *default* routing, not a
constraint: Hirsala reports `nine1: 1, nine2: 2`, and the nine-hole round above
was still created against it with `nine2: 0`.

### A multi-nine facility appears once per nine pair

The course ID encodes which two nines it stands for. Nevas Golf's three entries
share one facility ID and differ only in the second and third characters:

```text
0[12]1184662556869   Kettu + Karppi
0[13]1184662556869   Kettu + Rapu
0[23]1184662556869   Karppi + Rapu
```

Nurmijärven Golfklubi (`A + B`, `A + C`, `B + C`) is laid out the same way. Across
a 100-course search those two clubs were the only ones not on the `0121` prefix, so
`0121` is simply "nines 1 and 2" — what a single-18 or nine-hole course reports too.

Three things follow. Searching for such a club returns it three times, once per
pair. `numHoles` in a search hit describes the pair (18), while the course detail
describes the whole facility (`numHoles: 27`, `numNines: 3`). And the detail fetched
from *any* of the three IDs carries the par and rating tables for all nine
combinations — so the ID picks a default routing rather than limiting what can be
played. Whether the server accepts a round whose nines fall outside the ID's own
pair is not captured; the conservative move is to use the ID whose name matches the
nines you want.

One wrinkle for parsers: in that search, `numHoles` came back as a string (`"18"`)
for most courses but as a number (`18`) for the `0131` and `0231` entries.

**Grouping the variants back together.** Strip the four-character prefix and what
remains identifies the facility. Nothing else in the payload will do it: there is no
club ID, `courseBaseName` merely repeats `courseName`, and club name over-groups
badly — of 19 clubs with more than one course in that search, only these two were
nine-pair facilities. Pickala Golf's four eighteens and GolfStar Kurk Golf's seven
courses share a name but are genuinely separate, and Nurmijärvi's standalone Par 3
must stay apart from its three pairings. Grouping on the stripped ID gets all of
these right; grouping on club name gets none of them right.

### The four ID namespaces (and where `sid` comes from)

These do not interchange, which is why a `sid` never matches anything in a
`findFriends.php` response:

| ID | Example | Scope | Minted by |
| --- | --- | --- | --- |
| `userID` | `694833` | An mScorecard account | Server, at signup |
| `ID` (findFriends) | `207653` | *Someone else's* account | Server |
| `playerID` / `PID` | `1788645892735896` | An entry in **your** player roster | Client |
| `sid` | `28456999` | One player's row **in one round** | Server, at round creation |

`playerID`s are minted client-side as `Date.now()` plus three extra digits. Toni
was searched for at `timestamp=1788645877002` and the roster entry the app then
created for him is `1788645892735896` — i.e. `1788645892735` ms, 15 seconds after
the search, plus `896`. On the first search his `PID` was `null`; after he was
added it came back as that value.

`sid` is a scorecard *row* ID, not a player identity. The same person gets a
different `sid` in every round. You never invent one: you send negative
placeholder IDs when creating the round and the server hands back the mapping.

### Create a multi-player round and obtain the `sid`s

`PUT /api/v2.3/rounds/<roundID>` with `ts: 0` (meaning "this round is new") and one
`scores[]` entry per player. Each entry carries `ID: -1`, `-2`, `-3`… as a
placeholder and identifies the human only by their roster `playerID`:

```json
{
  "ts": 0,
  "submitHcpRound": 0,
  "round": {
    "roundID": "1788647732160",
    "courseID": "0121568050825406011",
    "nine1": 1, "nine2": 0,
    "courseChanged": 1,
    "date": "202609060100",
    "hcpRoundSubmitted": 0,
    "numGroups": 1, "numPlayers": 3,
    "markerName": "", "finished": 0, "noNotifications": 1, "competitionName": "",
    "scores": [
      {"ID": -1, "modified": 1, "courseHcp": 17, "teeID": "208146", "extTeeID": 5,
       "playerNum": 1, "groupNum": 1, "hcpAllowance": 100, "hcpBefore": 14.8,
       "hcpRound": 1, "playerID": "1618037712778955", "gender": "1"},
      {"ID": -2, "modified": 1, "courseHcp": 36, "teeID": "208146", "extTeeID": 5,
       "playerNum": 2, "groupNum": 1, "hcpAllowance": 100, "hcpBefore": 36,
       "hcpRound": 0, "playerID": "1788645892735896", "gender": "1"},
      {"ID": -3, "modified": 1, "courseHcp": 54, "teeID": "208149", "extTeeID": 2,
       "playerNum": 3, "groupNum": 1, "hcpAllowance": 100, "hcpBefore": 54,
       "hcpRound": 0, "playerID": "1619952902663", "gender": "0"}
    ],
    "scoresDeleted": [], "modifiedFields": null,
    "showAdjustedScore": 0, "gameFormat": 0
  }
}
```

Note that the request contains **no names**. The response supplies them, which
means the server resolved each `playerID` against the caller's roster — so a
player has to exist in the roster (`syncplayers.php`) before a round can reference
them. Note also that all three came back with `"playerUserID": "694833"`: they are
all entries in Lasse's roster, even though Toni has an mScorecard account of his own.

The response pairs each new `sid` with the placeholder that produced it via
`oldSid`:

```json
{
  "ts": "1788647779543309",
  "round": {
    "roundID": "1788647732160", "userID": "694833",
    "joinCode": "5vzi3dfy",
    "viewLink": "token=92f63669927e9514!1788647732160!694833",
    "scores": [
      {"sid": "28456998", "oldSid": -1, "name": "Lasse Koskela", "shortName": "LK",
       "playerID": "1618037712778955", "playerUserID": "694833", "hcp": 17,
       "st": [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1], "…": "…"},
      {"sid": "28456999", "oldSid": -2, "name": "Toni Marttila", "…": "…"},
      {"sid": "28457000", "oldSid": -3, "name": "Lotta", "…": "…"}
    ]
  }
}
```

Per-hole arrays use `-1` for "not entered": `st` strokes, `pu` putts, `fw`
fairway, `pe` penalties, `sa`/`sv` sand, `ch`, `cl` club.

### The `ts` version token

`ts` is a per-round optimistic-concurrency token (a microsecond epoch, as a
string). Every write echoes the `ts` from the previous response on that round and
receives the next one. From the captures:

```text
PUT  (create)  ts: 0                 →  ts: 1788647779543309
PATCH (hole 1) ts: 1788647779543309  →  ts: 1788647977927609
PATCH (hole 2) ts: 1788647977927609  →  ts: 1788648144133378
```

### Update scores in a player's mscorecard round

Player 1 (`"sid":"28456893"`) hit 5 strokes (`"st":5`) on hole 1 (`"h":1`). Player 2 (`"sid":"28456894"`) hit 7 strokes (`"st":7`). Here's how the scores are logged to the round:

```shell
curl -X PATCH 'https://www.mscorecard.com/api/v2.3/rounds/<round ID>' \
    -H 'Authorization: Bearer <access token>' \
    -H 'Content-Type: application/json' \
    --raw-data '{"ts":"1788644219416430","scores":[{"sid":"28456893", "h":1, "st":5},{"sid":"28456894","h":1,"st":7}]}'
```

The response contains simply an HTTP 200 status code and `{"ts": "1788644259132644"}`.

### Mark the round as finished

Send a `PUT` request with instructions to mark the round as finished:

```shell
curl -X PUT 'https://www.mscorecard.com/api/v2.3/rounds/<round ID>' \
    -H 'Authorization: Bearer <access token>' \
    -H 'Content-Type: application/json' \
    --raw-data '...'
```

...with the following JSON body:

```json
{
  "ts": "1788644651395956",
  "submitHcpRound": 0,
  "round": {
    "roundID": "1788643812694",
    "courseID": "0121371825104923099",
    "nine1": 1,
    "nine2": 2,
    "courseChanged": 0,
    "date": "202609060000",
    "hcpRoundSubmitted": "0",
    "numGroups": 1,
    "numPlayers": 2,
    "markerName": "",
    "finished": 1,
    "noNotifications": 1,
    "competitionName": "",
    "scores": [],
    "scoresDeleted": [],
    "modifiedFields": [],
    "showAdjustedScore": 0,
    "gameFormat": 2
  }
}
```


### Delete a round

```shell
curl -X DELETE 'https://www.mscorecard.com/api/v2.3/rounds/<round ID>' \
    -H 'Authorization: Bearer <access token>' \
    -H 'Content-Type: application/json'
```

This is the odd one out among the writes, in three ways:

- **No `ts`.** Every other write has to echo the round's version token; this one
  does not, so it is the only round write you can make without having read the
  round first.
- **No body at all.** The captured request sends `Content-Length: 0`; the round ID
  in the URL is the entire request.
- **The response is a bare `[]`**, not an object — so unlike every other `v2.3`
  call it cannot carry a rotated `accessToken`, and a client that assumes an object
  response will choke on it.

```http
HTTP/1.1 200 OK
Content-Type: application/json

[]
```

Deleting works on a finished round as well as an open one, and there is no undo:
the round and every player's scores in it are gone.

### Submit a player's mscorecard round for HCP calculation

Send a PUT request to `https://www.mscorecard.com/api/v2.3/rounds/<round ID>`
with the following payload (and a bearer token in the "Authorization" header):

```json
{
  "ts": "1788617397630705",
  "submitHcpRound": 1,
  "round": {
    "roundID": "1788616184998",
    "courseID": "0121371825104923099",
    "nine1": 1,
    "nine2": 2,
    "courseChanged": 0,
    "date": "202609051600",
    "hcpRoundSubmitted": 1,
    "numGroups": 1,
    "numPlayers": 1,
    "markerName": "Lasse Koskela",
    "finished": 1,
    "noNotifications": 0,
    "competitionName": "Field test 5.9.2026",
    "userID": "694833",
    "scores": [
      {
        "ID": "28454959",
        "modified": 0,
        "courseHcp": 15,
        "teeID": "207397",
        "extTeeID": 4,
        "playerNum": 1,
        "groupNum": 1,
        "hcpAllowance": 100,
        "hcpBefore": 14.8,
        "hcpRound": 1,
        "playerID": "1618037712778955",
        "playerUserID": "694833",
        "gender": "1",
        "strokes": [ 5, 3, 4, 3, 6, 4, 4, 5, 5, 5, 5, 7, 3, 4, 5, 6, 5, 6 ]
      }
    ],
    "scoresDeleted": [],
    "modifiedFields": [],
    "showAdjustedScore": 0,
    "gameFormat": 0
  }
}
```

### Reading a round back, and the two different score shapes

```shell
curl 'https://www.mscorecard.com/api/v2.3/rounds/<round ID>?uid=&ver=9110' \
    -H 'Authorization: Bearer <access token>' \
    -H 'Content-Type: application/json'
```

Beware: **creating a round and reading one back do not use the same field names.**
The same score row appears as

| Creating (`PUT` response) | Reading (`GET` response) |
| --- | --- |
| `sid` | `ID` |
| `st`, `pu`, `fw`, `pe`, `cl` | `strokes`, `putts`, `fairways`, `penalties`, `clubs` |
| `name`, `shortName` flat on the row | nested under a `player` object |
| `hcp` | `courseHcp` |

A client that assumes one shape silently fails on the other.

### A scorecard is always eighteen slots long

Every card in every capture has exactly 18 entries, with `-1` for holes not played,
**whatever the round's length**. Two nine-hole rounds at Tapiola Golf, recorded the
two different ways the app allows:

```text
round 1631170306346   nine1: 1, nine2: 2   [-1×9, 7,7,4,4,5,5,5,6,6]
round 1788727140517   nine1: 2, nine2: 0   [6,7,4,4,7,6,6,5,5, -1×9]
```

The first is an 18-hole card with only the back half filled in; the second is a
genuine nine-hole round on nine 2. Both are nine holes of golf, and the second
confirms two things: `nine1: 2` rounds are real and app-created, and a nine-hole
round's scores go in **card positions 1-9** regardless of which nine was played.
Hole `h: 1` of a back-nine round is course hole 10.

The 18-slot rule matters most when submitting for handicap calculation, because that
`PUT` re-sends each player's whole card. Sending a nine-entry array for a nine-hole
round is not accepted as a short card — pad it to eighteen with `-1`.

### A nine-hole round has its own course ID

The `0<nine1><nine2>1` prefix encodes the second nine as `0` when there isn't one.
The round read back above embeds a course snapshot whose ID is

```text
0[20]1371825104923099   Tapiola Golf, back nine only
0[12]1371825104923099   Tapiola Golf, the 18-hole card
```

— the same facility, differing only in the nine digits. Any parser that expects
both digits to be 1-9 will fail to group these.

Note this is the *snapshot the server stored for the round*, not necessarily what
the client sent. The app created its nine-hole round at Hirsala by posting the
ordinary 18-hole `courseID` together with `nine1: 1, nine2: 0`, so the derived ID
appears to be the server's doing. Sending the 18-hole ID plus the nine selection is
what the app does and what a client should do.

### Stroke indexes are renumbered per nine configuration

Within any one card, one nine carries the odd stroke indexes 1-17 and the other the
even 2-18. Which nine gets which is not fixed, and the same nine can be numbered
differently depending on what it is paired with. Tapiola Golf's nine 1:

```text
parIndex_1_1  (played alone)         [13, 17, 11, 7, 5, 9, 3, 15, 1]   odd
parIndex_1_2  (the 18-hole card)     [14, 18, 12, 8, 6, 10, 4, 16, 2]  even
```

Every index is exactly one higher in the second, so the ranking of the holes is
untouched — only the numbering moves. Nine 2 meanwhile keeps `[3, 17, 11, 9, 15, 1,
7, 13, 5]` in both `parIndex_2_2` and the back half of `parIndex_1_2`.

Which nine holds the odd indexes in the standard routing varies by club. Of eight
courses captured, Tapiola, Hirsala, Vuosaari and Espoo Ringside give them to nine 2,
while Nevas, Helsingin Golfklubi and La Finca give them to nine 1.

For scoring this is immaterial: strokes are allocated hardest hole first, so only
the order matters. It matters for anything that displays or compares raw indexes.

### `hcpRound` is per player, not per round

Whether a round counts towards an official handicap is a field on each **score row**,
not on the round. In a group one player can be posting a score while another is out
for practice:

```json
"scores": [
  { "ID": "28454959", "playerID": "1618037712778955", "hcpRound": 1, "…": "…" },
  { "ID": "28454960", "playerID": "1788645892735896", "hcpRound": 0, "…": "…" }
]
```

The round-level counterpart is `hcpRoundSubmitted`, and the `PUT` that submits also
carries `submitHcpRound: 1` alongside the round object. Observed values of
`hcpRoundSubmitted` are `"0"` (not submitted), `"1"` (submitted) and `"2"` on an old
round that has since been processed.

A submission re-sends every score row in full. The captured payload carries
`courseHcp`, `teeID`, `extTeeID`, `playerNum`, `groupNum`, `hcpAllowance`,
`hcpBefore`, `hcpRound`, `playerID`, `playerUserID`, `gender` and the eighteen-slot
`strokes` array. Sending a thinner row risks the server defaulting the fields left
out — and `hcpRound` is the one that decides whether the round counts at all.

No capture shows the app toggling `hcpRound` on its own, so a client wanting to
change it has to model the request on the submission: the same score rows, with
`submitHcpRound: 0` and `finished` left as it was.

### `h` is the course hole number, not the position on the card

This one is easy to get wrong and fails silently. Scoring a back-nine round, the app
sends holes **10 to 18**:

```json
{"ts":"1788733204074678","scores":[
  {"sid":"28467063","h":10,"st":6},
  {"sid":"28467063","h":11,"st":7},
  … 
  {"sid":"28467063","h":18,"st":5}]}
```

Sending `h: 1..9` for the same round is accepted — HTTP 200, a fresh `ts`, no error
of any kind — and registers nothing. Two rounds created minutes apart at Tapiola
Golf, identical but for this:

```text
1788733175500   h: 10..18   "TotalStrokes": "50"    the app
1788732912360   h: 1..9     "TotalStrokes": "-"     a client that used positions
```

Both appear in the rounds list as "Tapiola Golf (Back 9)", so the round itself, its
course and its nines are all stored correctly. Only the scores go nowhere.

Note this is invisible on a front-nine round, where hole number and card position
are the same thing. It only shows up once `nine1` is not 1.

**The stored card is indexed the same way.** The eighteen-slot `strokes` array is
indexed by course hole — index `h - 1` — so a back-nine round fills indices 9-17 and
leaves 0-8 at `-1`:

```text
[-1, -1, -1, -1, -1, -1, -1, -1, -1, 6, 7, 4, 4, 7, 6, 6, 5, 5]
```

Every captured round agrees, once the rounds scored by a buggy client are set aside.
A card sitting at indices 0-8 on a `nine1: 2` round is the signature of exactly that
mistake: the strokes were filed against holes 1-9, which the round does not play, so
the app shows nothing.

### The rounds list

```shell
curl 'https://www.mscorecard.com/api/v2.3/rounds?pid=0' \
    -H 'Authorization: Bearer <access token>' \
    -H 'Content-Type: application/json'
```

```json
{"numRounds":8,"rounds":[
  {"RoundID":"1788733175500","Date":"202609070115","RoundDate":"07-Sep-2026",
   "CourseName":"Tapiola Golf (Back 9)","ClubName":"Tapiola Golf","Course":"Back 9",
   "TotalStrokes":"50","HcpRound":"0","HcpRoundSubmitted":"0","UserID":"694833"}]}
```

`TotalStrokes` is `"-"` when no scores registered, which makes this endpoint the
quickest way to tell whether a card actually landed.

### How the app computes `courseHcp`

The playing handicap on a scorecard is computed client-side; the server stores
whatever it is sent. Every value the app has been seen to write fits

```text
courseHcp = round(index x slope / 113 + (CR - Par))     capped at 54
```

using the **course's default eighteen-hole** rating and par — `ratings_1_2` and
`parIndex_1_2` on a two-nine course — regardless of which nines are actually played,
and the women's `slopeW`/`crW` for a female player. A `hcpType` of `"0"` is a plain
club handicap and is used verbatim instead.

| Player | Course, tee | Working | App wrote |
| --- | --- | --- | --- |
| 14.8 index | Hirsala, white | `14.8 x 131/113 + (72.6 - 73)` = 16.76 | 17 |
| 54 index, women's tee | Hirsala, red | `54 x 119/113 + (70.4 - 73)` = 54.27 | 54 |
| 14.1 index | Tapiola, tee 57 | `14.1 x 123/113 + (70.5 - 72)` = 13.85 | 14 |

Note it is **not** halved for a nine-hole round: a nine-hole card carries the full
eighteen-hole figure, and the halving happens when strokes are allocated.

Dropping the `CR - Par` term still fits Hirsala but gives 15 at Tapiola where the app
writes 14 — close enough to look right, which is why it is worth checking a computed
value against the app before submitting anything.

### A locked round accepts writes and ignores them

A round that has already been processed for handicap purposes cannot be scored any
more, but the API does not say so with an error. The `PATCH` succeeds:

```http
PATCH /api/v2.3/rounds/1631170306346
{"ts":"1788727445953218"}

HTTP/1.1 200 OK
{"ts":"1788727491448563","noEdit":1}
```

HTTP 200, a fresh version token, and a `noEdit: 1` that is the only sign anything is
wrong. A client checking the status code sees a success and loses the write. The same
flag appears on the round object itself when such a round is read back.

### Clearing a hole

A score is taken back off a hole by sending the same `-1` the API uses for a hole
never played:

```json
{"ts":"…","scores":[{"sid":"28467088","h":11,"st":-1}]}
```

Confirmed against the app: a hole cleared this way comes back empty. Note this is a
score `PATCH` like any other, so `h` is still the course hole number — clearing hole
11 of a back-nine round means `h: 11`, not the second position on the card.

### Friends: `addFriend.php`, and which IDs a round then uses

A real mScorecard user is added to the roster by their **user ID**, through an
endpoint of its own — not by uploading a player record:

```shell
curl -X POST 'https://www.mscorecard.com/mscorecardx/m/addFriend.php' \
    -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
    --data-raw 'email=<email>&password=<token>&versionNumber=9110&toUID=10981498&fromPID=&toEmail=&timestamp=…'
```

`toUID` is the `ID` from a `findFriends.php` hit. The response is the single
character `1`. Afterwards the roster (`syncplayers.php` with `download=1`) carries
the new entry, and three states are visible in it at once:

| Player | `friendUserID` | `friendPlayerID` | `friendStatus` |
| --- | --- | --- | --- |
| invented locally | `"0"` | `""` | `"0"` |
| request pending | `10981498` | `""` | `"1"` |
| link accepted | `207653` | `1438582589166807` | `"2"` |

**This changes which IDs the round payload uses.** Once a link is accepted the round
refers to that person by *their own* player record, under *their* user ID:

```json
{"playerID": "1618037712778955", "playerUserID": "694833"},   // us
{"playerID": "1438582589166807", "playerUserID": "207653"},   // Toni, accepted friend
{"playerID": "1788737332464851", "playerUserID": "694833"}    // Jarkko, still pending
```

Toni's roster entry in *our* roster is `1788645892735896`, and it is not what goes in
the round. A pending friend and a locally invented player both go in under our own
entry and our own user ID.

### A bare `ts` PATCH is a poll, not a write

The app keeps a round in sync by sending nothing but the version token:

```json
PATCH /api/v2.3/rounds/1788736538244
{"ts":"1788736826379014"}
```

The response is the next `ts`, plus a `scores` array whenever something has changed
since the one that was sent. It is the same endpoint used for writing scores, with
the `scores` field simply left out.

### Removing a player from a round

A player is taken off the card with a `PUT` that names their score row in
`scoresDeleted` and re-sends everyone who is left:

```json
{"ts":"1788737645975059","submitHcpRound":0,"round":{
  "roundID":"1788737212480", "numPlayers":2,
  "scores":[
    {"ID":"28467191","modified":1,"playerNum":1,"…":"…"},
    {"ID":"28467192","modified":1,"playerNum":2,"…":"…"}],
  "scoresDeleted":[{"ID":"28467190"}],
  "modifiedFields":[], "…":"…"}}
```

Three things to copy. `scoresDeleted` holds objects carrying nothing but `ID` — the
`sid` of the row. `numPlayers` comes down. And the survivors are **renumbered**: the
removed player was `playerNum` 1 of 3, and the other two arrive as 1 and 2 rather
than keeping 2 and 3.

### `modified`, and when to attach a card

The same `PUT` carries score rows for several different purposes, and the app varies
two fields depending on which:

| Doing what | `scores` | `modified` | `strokes` |
| --- | --- | --- | --- |
| Creating a round | every player, `ID` negative | 1 | absent |
| Changing `hcpRound` | **only the row that changed** | 1 | absent |
| Removing a player | everyone who is left | 1 | absent |
| Submitting for handicap | every player | 0 | present, 18 slots |

So a card rides along only when the write is actually about scores. Attaching one to
a flag change would rewrite whatever is already stored, and `modified: 0` appears
only on the submission, where the rows are being restated rather than edited.

### Finding a player, and putting them on a card

Searching is `findFriends.php` with a `searchString`. Every captured search is a
**name**; the response gives that person's own user `ID`, their handicap, and a `PID`
naming your roster entry for them when you already have one.

Searching by **email** is not captured, and the results suggest it would not help:
`Email` comes back as `""` on every hit. `addFriend.php` does take a `toEmail`
parameter alongside `toUID`, though — sent empty in the one capture — so inviting
someone by address, without searching first, looks supported.

Putting a player on a card has two halves. They must exist in the account's roster,
which for a real mScorecard user means `addFriend.php` first; a pending request is
enough, since a round refers to a pending friend by our own roster entry. Then the
player goes into the round's `scores[]`.

**Adding to a round that already exists** sends the new row and *only* the new row:

```json
{"ts":"1788738709550236","submitHcpRound":0,"round":{
  "roundID":"1788737212480","numPlayers":3,
  "scores":[{"ID":-1,"modified":1,"courseHcp":50,"teeID":"176354","extTeeID":2,
             "playerNum":3,"groupNum":1,"hcpAllowance":100,"hcpBefore":54,
             "hcpRound":0,"playerID":"1619952956183","playerUserID":"694833",
             "gender":"1"}],
  "scoresDeleted":[], "…":"…"}}
```

Note this is the **opposite** of a removal, which re-sends every surviving row. Here
the players already on the card are left out entirely. `ID: -1` is the same
placeholder used at creation, `numPlayers` is the new total and `playerNum` is the
position being taken.

The reply names just the row it created, with `oldSid` pointing back at the
placeholder — so the new `sid` comes straight back and the round need not be re-read:

```json
{"ts":"1788738729618916","round":{"numPlayers":"3","scores":[
  {"sid":"28467211","oldSid":-1,"name":"Luka","hcp":50,"hcpBefore":54,
   "teeID":"176354","playerNum":3,"playerID":"1619952956183","…":"…"}]}}
```

### Changing a round's date and time, and what `modifiedFields` is for

A round-level edit sends no scores at all and names what changed:

```json
{"ts":"1788738729618916","submitHcpRound":0,"round":{
  "roundID":"1788737212480","courseID":"0121247300657988","nine1":1,"nine2":2,
  "courseChanged":1,
  "date":"202609061710",
  "numPlayers":3,"finished":0,"userID":"694833",
  "scores":[], "scoresDeleted":[],
  "modifiedFields":[{"date":"202609061710"}],
  "showAdjustedScore":0,"gameFormat":0}}
```

This is the **only** capture in which `modifiedFields` carries anything, and it is
not simply "the fields that changed": changing the game format is a round-level edit
of exactly the same shape and sends `modifiedFields: []`. Finishing, submitting,
adding a player and removing one leave it empty too, and creation sends `null`. So
whatever the array is for, the date is special in it, and an empty one is what every
other edit uses.

The date is **local wall-clock time**: this round was moved to 17:10 in Helsinki and
went out as `202609061710`, with no offset applied. `courseChanged` is 1 here, as it
is at creation, though the course did not change; adding a player sends 0.

### Changing how a round is scored

The same round-level edit, with the new `gameFormat` and nothing else:

```json
{"ts":"1788739352120972","submitHcpRound":0,"round":{
  "roundID":"1788737212480","courseID":"0121247300657988","nine1":1,"nine2":2,
  "courseChanged":0, "date":"202609061710", "numPlayers":3, "finished":0,
  "userID":"694833",
  "scores":[], "scoresDeleted":[], "modifiedFields":[],
  "showAdjustedScore":0, "gameFormat":2}}
```

0 is Stroke Play, 1 Stroke Play NET, 2 Stableford, and moving between them leaves the
strokes untouched — only how the card is totalled changes. Note `courseChanged: 0`
here, where the date change sends 1, and `modifiedFields` empty where the date change
names itself. The round comes back with `gameFormat` as a *string* (`"2"`) though the
request sends a number.
