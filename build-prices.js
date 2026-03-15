#!/usr/bin/env node
/**
 * build-prices.js
 * Downloads weapon + armour auction CSVs from CDN, computes all price
 * percentiles (weapon, bonus, class, set, and weapon+bonus combos),
 * and writes the result to rwp-prices.json.
 *
 * Used by the GitHub Action to keep PDA price data fresh.
 *
 * Usage:  node build-prices.js
 * Output: rwp-prices.json (same directory)
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ─── CDN URLs ────────────────────────────────────────────────
const WEAPON_CDN_URL = 'https://cdn.marches.cafe/items/weapon-auctions4.csv.gz';
const ARMOUR_CDN_URL = 'https://cdn.marches.cafe/items/armour-auctions4.csv.gz';
const COMBO_MIN_SAMPLES = 3;

// ─── Static mappings (must match the userscript) ─────────────

const ITEM_ID_MAP = {"1":"Hammer","2":"Baseball Bat","3":"Crowbar","4":"Knuckle Dusters","5":"Pen Knife","6":"Kitchen Knife","7":"Dagger","8":"Axe","9":"Scimitar","11":"Samurai Sword","12":"Glock 17","13":"Raven MP25","14":"Ruger 57","15":"Beretta M9","16":"USP","17":"Beretta 92FS","18":"Fiveseven","19":"Magnum","20":"Desert Eagle","22":"Sawed-Off Shotgun","23":"Benelli M1 Tactical","24":"MP5 Navy","25":"P90","26":"AK-47","27":"M4A1 Colt Carbine","28":"Benelli M4 Super","29":"M16 A2 Rifle","30":"Steyr AUG","31":"M249 SAW","63":"Minigun","99":"Springfield 1911","100":"Egg Propelled Launcher","108":"9mm Uzi","109":"RPG Launcher","110":"Leather Bullwhip","111":"Ninja Claws","146":"Yasukuni Sword","173":"Butterfly Knife","174":"XM8 Rifle","177":"Cobra Derringer","189":"S&W Revolver","217":"Claymore Sword","219":"Enfield SA-80","223":"Jackhammer","224":"Swiss Army Knife","225":"Mag 7","227":"Spear","228":"Vektor CR-21","231":"Heckler & Koch SL8","233":"BT MP9","234":"Chain Whip","235":"Wooden Nunchaku","236":"Kama","237":"Kodachi","238":"Sai","240":"Type 98 Anti Tank","243":"Taurus","245":"Bo Staff","247":"Katana","248":"Qsz-92","249":"SKS Carbine","252":"Ithaca 37","253":"Lorcin 380","254":"S&W M29","289":"Dual Axes","290":"Dual Hammers","391":"Macana","395":"Metal Nunchaku","397":"Flail","398":"SIG 552","399":"ArmaLite M-15A4","400":"Guandao","402":"Ice Pick","438":"Cricket Bat","439":"Frying Pan","483":"MP5k","484":"AK74U","485":"Skorpion","486":"TMP","487":"Thompson","488":"MP 40","489":"Luger","490":"Blunderbuss","612":"Tavor TAR-21","613":"Harpoon","614":"Diamond Bladed Knife","615":"Naval Cutlass","830":"Nock Gun","831":"Beretta Pico","832":"Riding Crop","837":"Rheinmetall MG 3","838":"Homemade Pocket Shotgun","846":"Scalpel","850":"Sledgehammer","1053":"Bread Knife","1055":"Poison Umbrella","1152":"SMAW Launcher","1153":"China Lake","1154":"Milkor MGL","1155":"PKM","1156":"Negev NG-5","1157":"Stoner 96","1158":"Meat Hook","1159":"Cleaver","1231":"Golf Club","1232":"Snow Cannon","1302":"Bushmaster Carbon 15","1303":"S&W M29","1360":"Riding Crop","1365":"Scalpel"};

const BONUS_ID_MAP = {"1":"Expose","14":"Proficience","20":"Stricken","21":"Plunder","33":"Blindfire","34":"Hazardous","35":"Spray","36":"Demoralize","37":"Storage","38":"Freeze","41":"Revitalize","42":"Wither","43":"Roshambo","44":"Slow","45":"Cripple","46":"Weaken","47":"Cupid","48":"Throttle","49":"Crusher","50":"Achilles","51":"Blindside","52":"Backstab","53":"Grace","54":"Berserk","55":"Conserve","56":"Eviscerate","57":"Bleed","58":"Stun","59":"Paralyze","60":"Suppress","61":"Motivation","62":"Deadly","63":"Deadeye","64":"Fury","65":"Rage","66":"Puncture","67":"Comeback","68":"Powerful","71":"Specialist","72":"Assassinate","73":"Smurf","74":"Double-Edged","75":"Execute","76":"Wind-Up","78":"Sure Shot","79":"Focus","80":"Frenzy","81":"Warlord","82":"Finale","83":"HomeRun","84":"Parry","85":"Bloodlust","86":"Disarm","87":"Empower","88":"Quicken","89":"Lacerate","101":"Penetrate","102":"Irradiate","103":"Toxin","104":"Smash","105":"Double-Tap","120":"Shock"};

const WEAPON_CLASS = {"AK74U":"Pistol / SMG","Enfield SA-80":"Shotgun / Rifle","SIG 552":"Shotgun / Rifle","USP":"Pistol / SMG","SKS Carbine":"Shotgun / Rifle","Cobra Derringer":"Pistol / SMG","Vektor CR-21":"Shotgun / Rifle","Macana":"Melee","Kodachi":"Melee","9mm Uzi":"Pistol / SMG","Heckler & Koch SL8":"Shotgun / Rifle","Type 98 Anti Tank":"Heavy","M249 SAW":"Heavy","Raven MP25":"Pistol / SMG","Desert Eagle":"Pistol / SMG","Ruger 57":"Pistol / SMG","ArmaLite M-15A4":"Shotgun / Rifle","Beretta M9":"Pistol / SMG","XM8 Rifle":"Shotgun / Rifle","Benelli M4 Super":"Shotgun / Rifle","Sai":"Melee","Swiss Army Knife":"Melee","Claymore Sword":"Melee","Yasukuni Sword":"Melee","Diamond Bladed Knife":"Melee","Metal Nunchaku":"Melee","Qsz-92":"Pistol / SMG","Kitchen Knife":"Melee","Mag 7":"Shotgun / Rifle","BT MP9":"Pistol / SMG","China Lake":"Heavy","Negev NG-5":"Heavy","Glock 17":"Pistol / SMG","Cricket Bat":"Melee","Blunderbuss":"Shotgun / Rifle","Ithaca 37":"Shotgun / Rifle","Tavor TAR-21":"Shotgun / Rifle","Samurai Sword":"Melee","RPG Launcher":"Heavy","Naval Cutlass":"Melee","Butterfly Knife":"Melee","TMP":"Pistol / SMG","Hammer":"Melee","Bo Staff":"Melee","M16 A2 Rifle":"Shotgun / Rifle","Jackhammer":"Shotgun / Rifle","Springfield 1911":"Pistol / SMG","Crowbar":"Melee","Katana":"Melee","Scimitar":"Melee","Ninja Claws":"Melee","Kama":"Melee","Leather Bullwhip":"Melee","Dagger":"Melee","Knuckle Dusters":"Melee","Beretta 92FS":"Pistol / SMG","Taurus":"Pistol / SMG","MP 40":"Pistol / SMG","MP5k":"Pistol / SMG","Baseball Bat":"Melee","M4A1 Colt Carbine":"Shotgun / Rifle","AK-47":"Shotgun / Rifle","Thompson":"Pistol / SMG","Magnum":"Pistol / SMG","Skorpion":"Pistol / SMG","Steyr AUG":"Shotgun / Rifle","S&W Revolver":"Pistol / SMG","Sawed-Off Shotgun":"Shotgun / Rifle","Spear":"Melee","Benelli M1 Tactical":"Shotgun / Rifle","Lorcin 380":"Pistol / SMG","Wooden Nunchaku":"Melee","Chain Whip":"Melee","Fiveseven":"Pistol / SMG","Axe":"Melee","Stoner 96":"Heavy","Flail":"Melee","SMAW Launcher":"Heavy","Minigun":"Heavy","PKM":"Heavy","Pen Knife":"Melee","Luger":"Pistol / SMG","Guandao":"Melee","Frying Pan":"Melee","Milkor MGL":"Heavy","P90":"Pistol / SMG","MP5 Navy":"Pistol / SMG","Bushmaster Carbon 15":"Pistol / SMG","Ice Pick":"Melee","Dual Axes":"Melee","Dual Hammers":"Melee","Harpoon":"Melee","Beretta Pico":"Pistol / SMG","Riding Crop":"Melee","Homemade Pocket Shotgun":"Shotgun / Rifle","Scalpel":"Melee","Sledgehammer":"Melee","Rheinmetall MG 3":"Heavy","Bread Knife":"Melee","Poison Umbrella":"Melee","Nock Gun":"Shotgun / Rifle","Snow Cannon":"Heavy","Egg Propelled Launcher":"Heavy","S&W M29":"Pistol / SMG","Meat Hook":"Melee","Cleaver":"Melee","Golf Club":"Melee"};

const ARMOUR_ID_MAP = {"1164":"M'aol Visage","1167":"M'aol Hooves","1307":"Sentinel Helmet","1308":"Sentinel Apron","1309":"Sentinel Pants","1310":"Sentinel Boots","1311":"Sentinel Gloves","1355":"Vanguard Respirator","1356":"Vanguard Body","1357":"Vanguard Pants","1358":"Vanguard Boots","1359":"Vanguard Gloves","178":"Flak Jacket","348":"Hazmat Suit","640":"Kevlar Gloves","641":"WWII Helmet","642":"Motorcycle Helmet","643":"Construction Helmet","644":"Welding Helmet","655":"Riot Helmet","656":"Riot Body","657":"Riot Pants","658":"Riot Boots","659":"Riot Gloves","660":"Dune Helmet","661":"Dune Vest","662":"Dune Pants","663":"Dune Boots","664":"Dune Gloves","665":"Assault Helmet","666":"Assault Body","667":"Assault Pants","668":"Assault Boots","669":"Assault Gloves","670":"Delta Gas Mask","671":"Delta Body","672":"Delta Pants","673":"Delta Boots","674":"Delta Gloves","675":"Marauder Face Mask","676":"Marauder Body","677":"Marauder Pants","678":"Marauder Boots","679":"Marauder Gloves","680":"EOD Helmet","681":"EOD Apron","682":"EOD Pants","683":"EOD Boots","684":"EOD Gloves"};

const ARMOUR_SET = {"M'aol Visage":"M'aol","M'aol Hooves":"M'aol","Sentinel Helmet":"Sentinel","Sentinel Apron":"Sentinel","Sentinel Pants":"Sentinel","Sentinel Boots":"Sentinel","Sentinel Gloves":"Sentinel","Vanguard Respirator":"Vanguard","Vanguard Body":"Vanguard","Vanguard Pants":"Vanguard","Vanguard Boots":"Vanguard","Vanguard Gloves":"Vanguard","Flak Jacket":"Other","Hazmat Suit":"Other","Kevlar Gloves":"Other","WWII Helmet":"Other","Motorcycle Helmet":"Other","Construction Helmet":"Other","Welding Helmet":"Other","Riot Helmet":"Riot","Riot Body":"Riot","Riot Pants":"Riot","Riot Boots":"Riot","Riot Gloves":"Riot","Dune Helmet":"Dune","Dune Vest":"Dune","Dune Pants":"Dune","Dune Boots":"Dune","Dune Gloves":"Dune","Assault Helmet":"Assault","Assault Body":"Assault","Assault Pants":"Assault","Assault Boots":"Assault","Assault Gloves":"Assault","Delta Gas Mask":"Delta","Delta Body":"Delta","Delta Pants":"Delta","Delta Boots":"Delta","Delta Gloves":"Delta","Marauder Face Mask":"Marauder","Marauder Body":"Marauder","Marauder Pants":"Marauder","Marauder Boots":"Marauder","Marauder Gloves":"Marauder","EOD Helmet":"EOD","EOD Apron":"EOD","EOD Pants":"EOD","EOD Boots":"EOD","EOD Gloves":"EOD"};

const ARMOUR_BONUS_MAP = {"112":"Kinetokinesis","115":"Immutable","121":"Irrepressible","15":"Impregnable","17":"Impenetrable","22":"Imperviable","26":"Impassable","90":"Radiation Protection","91":"Invulnerable","92":"Insurmountable"};

const RARITY_MAP = { '2': 'Yellow', '3': 'Orange', '4': 'Red' };

// ─── Helpers ─────────────────────────────────────────────────

function percentile(arr, p) {
    if (arr.length === 0) return null;
    const idx = (p / 100) * (arr.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return arr[lower];
    return arr[lower] + (arr[upper] - arr[lower]) * (idx - lower);
}

function fetchGzip(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (resp) => {
            if (resp.statusCode !== 200) {
                reject(new Error(`HTTP ${resp.statusCode} for ${url}`));
                resp.resume();
                return;
            }
            const chunks = [];
            resp.on('data', (chunk) => chunks.push(chunk));
            resp.on('end', () => {
                const buf = Buffer.concat(chunks);
                zlib.gunzip(buf, (err, decompressed) => {
                    if (err) reject(err);
                    else resolve(decompressed.toString('utf8'));
                });
            });
            resp.on('error', reject);
        }).on('error', reject);
    });
}

// ─── Weapon CSV parsing ──────────────────────────────────────

function parseWeaponCSV(csvText) {
    const lines = csvText.split('\n');
    const weaponGroups = {};
    const bonusGroups = {};
    const classGroups = {};
    const comboGroups = {};

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',');
        if (cols.length < 15) continue;

        const price = parseInt(cols[1], 10);
        const itemId = cols[6];
        const rarity = cols[9];
        if (rarity === '1' || !RARITY_MAP[rarity]) continue;

        const rarityName = RARITY_MAP[rarity];
        const weaponName = ITEM_ID_MAP[itemId];
        if (!weaponName || isNaN(price) || price <= 0) continue;

        // Weapon + rarity
        const wKey = weaponName + '|' + rarityName;
        if (!weaponGroups[wKey]) weaponGroups[wKey] = [];
        weaponGroups[wKey].push(price);

        // Bonuses + combos
        const bonusId1 = cols[14];
        if (bonusId1 && BONUS_ID_MAP[bonusId1]) {
            const bName1 = BONUS_ID_MAP[bonusId1];
            const bKey1 = bName1 + '|' + rarityName;
            if (!bonusGroups[bKey1]) bonusGroups[bKey1] = [];
            bonusGroups[bKey1].push(price);
            const cbKey1 = weaponName + '|' + bName1 + '|' + rarityName;
            if (!comboGroups[cbKey1]) comboGroups[cbKey1] = [];
            comboGroups[cbKey1].push(price);
        }
        if (cols.length > 16) {
            const bonusId2 = cols[16];
            if (bonusId2 && BONUS_ID_MAP[bonusId2]) {
                const bName2 = BONUS_ID_MAP[bonusId2];
                const bKey2 = bName2 + '|' + rarityName;
                if (!bonusGroups[bKey2]) bonusGroups[bKey2] = [];
                bonusGroups[bKey2].push(price);
                const cbKey2 = weaponName + '|' + bName2 + '|' + rarityName;
                if (!comboGroups[cbKey2]) comboGroups[cbKey2] = [];
                comboGroups[cbKey2].push(price);
            }
        }

        // Class group
        const cls = WEAPON_CLASS[weaponName];
        if (cls) {
            const cKey = cls + '|' + rarityName;
            if (!classGroups[cKey]) classGroups[cKey] = [];
            classGroups[cKey].push(price);
        }
    }

    function computePercentiles(groups, splitCount) {
        const result = {};
        for (const key of Object.keys(groups)) {
            const parts = key.split('|');
            const arr = groups[key].sort((a, b) => a - b);
            if (splitCount === 3 && arr.length < COMBO_MIN_SAMPLES) continue;
            const name = splitCount === 3 ? parts[0] + '|' + parts[1] : parts[0];
            const rar = parts[splitCount - 1];
            if (!result[name]) result[name] = {};
            result[name][rar] = [
                Math.round(percentile(arr, 25)),
                Math.round(percentile(arr, 50)),
                Math.round(percentile(arr, 75)),
                arr.length
            ];
        }
        return result;
    }

    return {
        weaponPrices: computePercentiles(weaponGroups, 2),
        bonusPrices: computePercentiles(bonusGroups, 2),
        classPrices: computePercentiles(classGroups, 2),
        weaponComboPrices: computePercentiles(comboGroups, 3)
    };
}

// ─── Armour CSV parsing ──────────────────────────────────────

function parseArmourCSV(csvText) {
    const lines = csvText.split('\n');
    const armourGroups = {};
    const bonusGroups = {};
    const setGroups = {};
    const comboGroups = {};

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',');
        if (cols.length < 15) continue;

        const price = parseInt(cols[1], 10);
        const itemId = cols[6];
        const rarity = cols[9];
        if (rarity === '1' || !RARITY_MAP[rarity]) continue;

        const rarityName = RARITY_MAP[rarity];
        const armourName = ARMOUR_ID_MAP[itemId];
        if (!armourName || isNaN(price) || price <= 0) continue;

        // Armour + rarity
        const aKey = armourName + '|' + rarityName;
        if (!armourGroups[aKey]) armourGroups[aKey] = [];
        armourGroups[aKey].push(price);

        // Bonuses + combos
        const bonusId1 = cols[14];
        if (bonusId1 && ARMOUR_BONUS_MAP[bonusId1]) {
            const bName1 = ARMOUR_BONUS_MAP[bonusId1];
            const bKey1 = bName1 + '|' + rarityName;
            if (!bonusGroups[bKey1]) bonusGroups[bKey1] = [];
            bonusGroups[bKey1].push(price);
            const cbKey1 = armourName + '|' + bName1 + '|' + rarityName;
            if (!comboGroups[cbKey1]) comboGroups[cbKey1] = [];
            comboGroups[cbKey1].push(price);
        }
        if (cols.length > 16) {
            const bonusId2 = cols[16];
            if (bonusId2 && ARMOUR_BONUS_MAP[bonusId2]) {
                const bName2 = ARMOUR_BONUS_MAP[bonusId2];
                const bKey2 = bName2 + '|' + rarityName;
                if (!bonusGroups[bKey2]) bonusGroups[bKey2] = [];
                bonusGroups[bKey2].push(price);
                const cbKey2 = armourName + '|' + bName2 + '|' + rarityName;
                if (!comboGroups[cbKey2]) comboGroups[cbKey2] = [];
                comboGroups[cbKey2].push(price);
            }
        }

        // Set group
        const setName = ARMOUR_SET[armourName];
        if (setName) {
            const sKey = setName + '|' + rarityName;
            if (!setGroups[sKey]) setGroups[sKey] = [];
            setGroups[sKey].push(price);
        }
    }

    function computePercentiles(groups, splitCount) {
        const result = {};
        for (const key of Object.keys(groups)) {
            const parts = key.split('|');
            const arr = groups[key].sort((a, b) => a - b);
            if (splitCount === 3 && arr.length < COMBO_MIN_SAMPLES) continue;
            const name = splitCount === 3 ? parts[0] + '|' + parts[1] : parts[0];
            const rar = parts[splitCount - 1];
            if (!result[name]) result[name] = {};
            result[name][rar] = [
                Math.round(percentile(arr, 25)),
                Math.round(percentile(arr, 50)),
                Math.round(percentile(arr, 75)),
                arr.length
            ];
        }
        return result;
    }

    return {
        armourPrices: computePercentiles(armourGroups, 2),
        armourBonusPrices: computePercentiles(bonusGroups, 2),
        armourSetPrices: computePercentiles(setGroups, 2),
        armourComboPrices: computePercentiles(comboGroups, 3)
    };
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
    console.log('Downloading weapon auctions CSV...');
    const weaponCSV = await fetchGzip(WEAPON_CDN_URL);
    console.log(`  ${weaponCSV.split('\n').length} lines`);

    console.log('Downloading armour auctions CSV...');
    const armourCSV = await fetchGzip(ARMOUR_CDN_URL);
    console.log(`  ${armourCSV.split('\n').length} lines`);

    console.log('Parsing weapon data...');
    const weapon = parseWeaponCSV(weaponCSV);
    console.log(`  ${Object.keys(weapon.weaponPrices).length} weapons, ${Object.keys(weapon.weaponComboPrices).length} combos`);

    console.log('Parsing armour data...');
    const armour = parseArmourCSV(armourCSV);
    console.log(`  ${Object.keys(armour.armourPrices).length} armour pieces, ${Object.keys(armour.armourComboPrices).length} combos`);

    const output = {
        weaponPrices: weapon.weaponPrices,
        bonusPrices: weapon.bonusPrices,
        classPrices: weapon.classPrices,
        armourPrices: armour.armourPrices,
        armourBonusPrices: armour.armourBonusPrices,
        armourSetPrices: armour.armourSetPrices,
        weaponComboPrices: weapon.weaponComboPrices,
        armourComboPrices: armour.armourComboPrices,
        timestamp: Date.now()
    };

    const outPath = path.join(__dirname, 'rwp-prices.json');
    fs.writeFileSync(outPath, JSON.stringify(output));
    const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`\nWrote ${outPath} (${sizeKB} KB)`);
}

main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
