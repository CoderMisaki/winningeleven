// src/data/teamRatings.js

const rawTeamRatings = [
  { "id": 1, "name": "Brazil", "code": "BRA", "attack": 95, "defense": 82, "midfield": 90, "speed": 88, "power": 85, "stamina": 84, "overall": 91 },
  { "id": 2, "name": "France", "code": "FRA", "attack": 90, "defense": 88, "midfield": 92, "speed": 84, "power": 86, "stamina": 85, "overall": 89 },
  { "id": 3, "name": "Italy", "code": "ITA", "attack": 86, "defense": 95, "midfield": 88, "speed": 82, "power": 87, "stamina": 88, "overall": 89 },
  { "id": 4, "name": "Argentina", "code": "ARG", "attack": 91, "defense": 84, "midfield": 89, "speed": 85, "power": 82, "stamina": 85, "overall": 88 },
  { "id": 5, "name": "Germany", "code": "GER", "attack": 87, "defense": 86, "midfield": 86, "speed": 81, "power": 89, "stamina": 90, "overall": 87 },
  { "id": 6, "name": "Holland", "code": "HOL", "attack": 89, "defense": 82, "midfield": 87, "speed": 87, "power": 83, "stamina": 84, "overall": 86 },
  { "id": 7, "name": "Portugal", "code": "POR", "attack": 87, "defense": 83, "midfield": 88, "speed": 88, "power": 80, "stamina": 83, "overall": 86 },
  { "id": 8, "name": "Spain", "code": "ESP", "attack": 86, "defense": 84, "midfield": 90, "speed": 83, "power": 80, "stamina": 84, "overall": 85 },
  { "id": 9, "name": "England", "code": "ENG", "attack": 88, "defense": 86, "midfield": 87, "speed": 84, "power": 86, "stamina": 86, "overall": 87 },
  { "id": 10, "name": "Czech", "code": "CZE", "attack": 85, "defense": 83, "midfield": 86, "speed": 81, "power": 85, "stamina": 83, "overall": 84 },
  { "id": 11, "name": "Mexico", "code": "MEX", "attack": 80, "defense": 78, "midfield": 82, "speed": 83, "power": 76, "stamina": 84, "overall": 81 },
  { "id": 12, "name": "Croatia", "code": "CRO", "attack": 80, "defense": 80, "midfield": 81, "speed": 78, "power": 81, "stamina": 82, "overall": 80 },
  { "id": 13, "name": "Serbia & Mont.", "code": "SAM", "attack": 79, "defense": 83, "midfield": 79, "speed": 76, "power": 84, "stamina": 80, "overall": 80 },
  { "id": 14, "name": "Sweden", "code": "SWE", "attack": 84, "defense": 79, "midfield": 80, "speed": 81, "power": 83, "stamina": 81, "overall": 81 },
  { "id": 15, "name": "Uruguay", "code": "URU", "attack": 82, "defense": 81, "midfield": 79, "speed": 80, "power": 83, "stamina": 82, "overall": 81 },
  { "id": 16, "name": "Chile", "code": "CHI", "attack": 78, "defense": 75, "midfield": 78, "speed": 81, "power": 76, "stamina": 80, "overall": 78 },
  { "id": 17, "name": "Colombia", "code": "COL", "attack": 79, "defense": 77, "midfield": 80, "speed": 82, "power": 78, "stamina": 80, "overall": 79 },
  { "id": 18, "name": "Denmark", "code": "DEN", "attack": 79, "defense": 80, "midfield": 80, "speed": 79, "power": 82, "stamina": 82, "overall": 80 },
  { "id": 19, "name": "Ivory Coast", "code": "CIV", "attack": 85, "defense": 77, "midfield": 81, "speed": 85, "power": 86, "stamina": 83, "overall": 83 },
  { "id": 20, "name": "Nigeria", "code": "NGA", "attack": 82, "defense": 75, "midfield": 79, "speed": 87, "power": 82, "stamina": 81, "overall": 81 },
  { "id": 21, "name": "Paraguay", "code": "PAR", "attack": 77, "defense": 80, "midfield": 76, "speed": 77, "power": 80, "stamina": 81, "overall": 78 },
  { "id": 22, "name": "Turkey", "code": "TUR", "attack": 81, "defense": 79, "midfield": 82, "speed": 81, "power": 80, "stamina": 82, "overall": 81 },
  { "id": 23, "name": "Cameroon", "code": "CMR", "attack": 84, "defense": 78, "midfield": 79, "speed": 84, "power": 85, "stamina": 82, "overall": 82 },
  { "id": 24, "name": "Greece", "code": "GRE", "attack": 75, "defense": 85, "midfield": 77, "speed": 74, "power": 83, "stamina": 83, "overall": 79 },
  { "id": 25, "name": "Japan", "code": "JPN", "attack": 75, "defense": 74, "midfield": 80, "speed": 80, "power": 72, "stamina": 83, "overall": 77 },
  { "id": 26, "name": "Russia", "code": "RUS", "attack": 77, "defense": 77, "midfield": 78, "speed": 78, "power": 80, "stamina": 80, "overall": 78 },
  { "id": 27, "name": "Ukraine", "code": "UKR", "attack": 83, "defense": 78, "midfield": 78, "speed": 80, "power": 81, "stamina": 81, "overall": 80 },
  { "id": 28, "name": "United States", "code": "USA", "attack": 76, "defense": 77, "midfield": 78, "speed": 81, "power": 80, "stamina": 84, "overall": 79 },
  { "id": 29, "name": "Australia", "code": "AUSB", "attack": 78, "defense": 76, "midfield": 78, "speed": 78, "power": 83, "stamina": 82, "overall": 79 },
  { "id": 30, "name": "Belgium", "code": "BEL", "attack": 76, "defense": 77, "midfield": 77, "speed": 76, "power": 79, "stamina": 78, "overall": 77 },
  { "id": 31, "name": "Ecuador", "code": "ECU", "attack": 76, "defense": 75, "midfield": 76, "speed": 81, "power": 78, "stamina": 81, "overall": 77 },
  { "id": 32, "name": "Ghana", "code": "GHA", "attack": 79, "defense": 76, "midfield": 83, "speed": 83, "power": 83, "stamina": 84, "overall": 81 },
  { "id": 33, "name": "Ireland", "code": "IRL", "attack": 77, "defense": 77, "midfield": 77, "speed": 77, "power": 81, "stamina": 82, "overall": 78 },
  { "id": 34, "name": "Korea", "code": "KOR", "attack": 74, "defense": 73, "midfield": 77, "speed": 83, "power": 73, "stamina": 87, "overall": 77 },
  { "id": 35, "name": "Switzerland", "code": "SWISS", "attack": 76, "defense": 80, "midfield": 78, "speed": 77, "power": 79, "stamina": 81, "overall": 78 },
  { "id": 36, "name": "Norway", "code": "NOR", "attack": 77, "defense": 77, "midfield": 75, "speed": 75, "power": 83, "stamina": 80, "overall": 77 },
  { "id": 37, "name": "Peru", "code": "PER", "attack": 76, "defense": 72, "midfield": 75, "speed": 78, "power": 74, "stamina": 76, "overall": 75 },
  { "id": 38, "name": "Poland", "code": "POL", "attack": 76, "defense": 76, "midfield": 76, "speed": 77, "power": 80, "stamina": 79, "overall": 77 },
  { "id": 39, "name": "Romania", "code": "ROU", "attack": 79, "defense": 76, "midfield": 80, "speed": 78, "power": 76, "stamina": 77, "overall": 78 },
  { "id": 40, "name": "Slovakia", "code": "SVK", "attack": 74, "defense": 74, "midfield": 74, "speed": 75, "power": 77, "stamina": 77, "overall": 75 },
  { "id": 41, "name": "Austria", "code": "AUT", "attack": 73, "defense": 74, "midfield": 74, "speed": 74, "power": 77, "stamina": 76, "overall": 74 },
  { "id": 42, "name": "Bulgaria", "code": "BUL", "attack": 77, "defense": 72, "midfield": 76, "speed": 76, "power": 75, "stamina": 75, "overall": 75 },
  { "id": 43, "name": "Costa Rica", "code": "COS", "attack": 73, "defense": 71, "midfield": 73, "speed": 77, "power": 72, "stamina": 76, "overall": 73 },
  { "id": 44, "name": "Scotland", "code": "SCO", "attack": 73, "defense": 75, "midfield": 74, "speed": 73, "power": 79, "stamina": 79, "overall": 74 },
  { "id": 45, "name": "South Africa", "code": "ZAF", "attack": 73, "defense": 71, "midfield": 73, "speed": 79, "power": 74, "stamina": 77, "overall": 73 },
  { "id": 46, "name": "Tunisia", "code": "TUN", "attack": 71, "defense": 72, "midfield": 72, "speed": 75, "power": 73, "stamina": 76, "overall": 72 },
  { "id": 47, "name": "Wales", "code": "WAL", "attack": 75, "defense": 72, "midfield": 73, "speed": 78, "power": 75, "stamina": 76, "overall": 73 },
  { "id": 48, "name": "Finland", "code": "FIN", "attack": 73, "defense": 72, "midfield": 72, "speed": 72, "power": 77, "stamina": 75, "overall": 73 },
  { "id": 49, "name": "Hungary", "code": "HUN", "attack": 72, "defense": 71, "midfield": 72, "speed": 73, "power": 74, "stamina": 74, "overall": 72 },
  { "id": 50, "name": "Iran", "code": "IRN", "attack": 72, "defense": 70, "midfield": 71, "speed": 74, "power": 73, "stamina": 76, "overall": 71 },
  { "id": 51, "name": "Slovenia", "code": "SLO", "attack": 71, "defense": 73, "midfield": 72, "speed": 72, "power": 75, "stamina": 75, "overall": 72 },
  { "id": 52, "name": "Latvia", "code": "LVA", "attack": 70, "defense": 71, "midfield": 70, "speed": 71, "power": 75, "stamina": 73, "overall": 71 },
  { "id": 53, "name": "Northern Ireland", "code": "NIL", "attack": 70, "defense": 72, "midfield": 71, "speed": 71, "power": 76, "stamina": 75, "overall": 71 },
  { "id": 54, "name": "Saudi Arabia", "code": "ARB", "attack": 70, "defense": 68, "midfield": 71, "speed": 74, "power": 68, "stamina": 73, "overall": 69 },
  { "id": 55, "name": "Angola", "code": "ANG", "attack": 69, "defense": 69, "midfield": 70, "speed": 75, "power": 72, "stamina": 74, "overall": 69 },
  { "id": 56, "name": "Togo", "code": "TOG", "attack": 73, "defense": 68, "midfield": 70, "speed": 76, "power": 74, "stamina": 73, "overall": 70 },
  { "id": 57, "name": "Trinidad & Tobago", "code": "TRI", "attack": 71, "defense": 68, "midfield": 69, "speed": 74, "power": 72, "stamina": 73, "overall": 69 }
];

// Mapping dari kode JSON rating ke kode yang dipakai teamsDB lama.
const RATING_CODE_TO_APP_CODE = {
  HOL: "NED",
  SAM: "SCG",
  AUSB: "AUS",
  SWISS: "SUI",
  COS: "CRC",
  ZAF: "RSA",
  NIL: "NIR",
  ARB: "KSA"
};

export const teamRatings = {};

for (const team of rawTeamRatings) {
  const appCode = RATING_CODE_TO_APP_CODE[team.code] || team.code;

  teamRatings[appCode] = {
    ...team,
    code: appCode,
    originalCode: team.code
  };
}
