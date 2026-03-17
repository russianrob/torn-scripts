// ==UserScript==
// @name         Torn RW Weapon Pricer
// @namespace    torn.rw.weapon.pricer
// @version      1.2.1
// @description  RW weapon and armour price estimator using real auction house data. Shows p25/median/p75 prices by weapon/armour, quality, and bonus from 227K+ auction sales.
// @author       RussianRob
// @match        https://www.torn.com/item*
// @match        https://www.torn.com/bazaar*
// @match        https://www.torn.com/amarket*
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/page.php?sid=auctionHouse*
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://tornwar.com/scripts/torn-rw-weapon-pricer.user.js
// @updateURL    https://tornwar.com/scripts/torn-rw-weapon-pricer.meta.js
// ==/UserScript==

// =============================================================================
// CHANGELOG
// =============================================================================
// v1.2.1  - Update URLs to tornwar.com hosting
// v1.2.0  - Fix: add 24 missing weapon IDs to floating panel
// v1.1.0  - Add armour pricing
// v1.0.0  - Initial release: RW weapon price estimator using real
//           auction house data (p25/median/p75 by weapon, quality, bonus)
// =============================================================================

(function() {
    'use strict';

    // ─── Embedded Price Data (227K+ auction records, last 90 days) ───

    const WEAPON_PRICES = {"AK74U":{"Orange":[96000001,149942222,497049605,66],"Red":[392350377,511141112,655555556,12],"Yellow":[25509512,35000001,147813758,288]},"Enfield SA-80":{"Yellow":[70000001,105000001,204873404,529],"Orange":[327777779,670000001,1570000001,49],"Red":[1444444445,3765432124,4150000001,4]},"SIG 552":{"Yellow":[62121778,74000001,122322213,481],"Orange":[283236359,569000001,1210429401,64],"Red":[1995000001,3378000001,3556862806,5]},"USP":{"Yellow":[25000000,26418001,31473676,217],"Orange":[87500001,136631317,213328763,55]},"SKS Carbine":{"Yellow":[58000001,58719001,130000001,195],"Orange":[171495001,180000001,259000001,27],"Red":[576091778,789000001,797014693,6]},"Cobra Derringer":{"Yellow":[24800001,26630166,30387085,289],"Orange":[100000001,138000001,250000001,73],"Red":[590000001,1620928420,2717951676,7]},"Vektor CR-21":{"Yellow":[58000000,58750001,62700001,241],"Orange":[174301011,186876801,265000001,49],"Red":[777777777,777777778,832233446,5]},"Macana":{"Yellow":[120000001,160000001,253891993,361],"Orange":[325000001,801000001,1133333334,33],"Red":[1527437790,6500000001,9370548946,4]},"Kodachi":{"Yellow":[50000001,110319880,255000001,324],"Orange":[267185746,499000001,1211073501,33]},"9mm Uzi":{"Yellow":[27500000,35000001,161111112,376],"Orange":[110000001,150000001,258641196,63],"Red":[405523392,1153740945,2000000001,4]},"Heckler & Koch SL8":{"Yellow":[58000001,58750001,62300001,263],"Orange":[173316003,185582812,270000001,52],"Red":[610000001,655614656,821488977,10]},"Type 98 Anti Tank":{"Yellow":[81012778,88214778,117000001,74],"Orange":[248221778,251447801,269854778,8]},"M249 SAW":{"Yellow":[81481778,87000001,96600001,76],"Orange":[263592778,370000001,1918180838,11]},"Raven MP25":{"Yellow":[23641778,24684778,25252526,155],"Orange":[70000001,91000001,111816778,33]},"Desert Eagle":{"Yellow":[24545455,25562253,29000001,228],"Orange":[77112778,100000001,125000001,56],"Red":[377489255,450000001,722222314,9]},"Ruger 57":{"Yellow":[24000001,25121778,28000001,186],"Orange":[75501011,102961778,177000001,53],"Red":[350000001,444543445,752980943,10]},"ArmaLite M-15A4":{"Yellow":[117000001,167000001,273000001,703],"Orange":[701000001,1211000001,2200000001,64]},"Beretta M9":{"Orange":[74700001,105000001,150000001,40],"Yellow":[24000001,25141415,27673001,174],"Red":[353272181,559000001,700000001,6]},"XM8 Rifle":{"Yellow":[58000001,58700001,62700001,235],"Orange":[171612778,180000001,250050001,61]},"Benelli M4 Super":{"Yellow":[58300001,61004001,69000001,328],"Orange":[194000001,300000001,456887256,67],"Red":[1020000001,2567927977,3600000001,8]},"Sai":{"Orange":[105498778,118888889,180000142,39],"Yellow":[35000001,35555556,39000001,145]},"Swiss Army Knife":{"Yellow":[34512346,35300001,37500001,124],"Orange":[106200001,137777778,173986853,22]},"Claymore Sword":{"Yellow":[38000001,50000001,91031212,245],"Orange":[170959367,400000001,652294308,35],"Red":[1016016516,1100000001,1687795808,8]},"Yasukuni Sword":{"Yellow":[51000001,87000001,186665556,310],"Orange":[182012733,589000001,1438731663,33]},"Diamond Bladed Knife":{"Yellow":[160000001,216478581,327020327,286],"Orange":[723576768,951060001,1400000000,40]},"Metal Nunchaku":{"Yellow":[71000001,92000001,143773538,329],"Orange":[356000001,733672995,950000001,41]},"Qsz-92":{"Yellow":[34500001,44444445,61987524,360],"Red":[2050677781,3843741887,4100000001,8],"Orange":[265555556,447000001,527000001,64]},"Kitchen Knife":{"Yellow":[34861778,36007511,39627001,122],"Orange":[104850001,110000001,184959708,30],"Red":[474741778,500000001,500000001,5]},"Mag 7":{"Yellow":[58112778,60000266,70000001,278],"Orange":[188500001,240000001,356100001,59],"Red":[791000001,1657000001,3069000001,6]},"BT MP9":{"Yellow":[41111112,75000001,123400001,493],"Orange":[152000000,420000001,625000001,80]},"P90":{"Orange":[89878603,122520613,280000001,52],"Yellow":[26062827,34044053,161963575,320],"Red":[845000001,1251000001,1500000001,4]},"China Lake":{"Yellow":[82000002,89355001,123000001,93],"Orange":[286923074,390000001,860000001,12]},"Negev NG-5":{"Yellow":[81768778,85541778,93300001,88],"Orange":[255555556,363000001,610052531,14]},"Glock 17":{"Yellow":[24000001,25012778,26421778,185],"Orange":[73812778,113509010,222286630,49],"Red":[400088059,894757600,3500000001,5]},"Cricket Bat":{"Yellow":[34665014,35400001,38000001,125],"Orange":[105300001,108000001,155301552,24]},"Blunderbuss":{"Orange":[174301562,179000001,269960414,58],"Yellow":[57601652,58901652,65000001,219],"Red":[513000001,530000001,569960401,3]},"Ithaca 37":{"Orange":[175600001,257242501,290800001,67],"Yellow":[58000001,60000000,71016227,266],"Red":[771727501,888889537,1051994201,6]},"Tavor TAR-21":{"Yellow":[59261779,66865045,93500001,481],"Orange":[213000001,415025785,855555557,53],"Red":[1225000001,2410734128,10710737501,7]},"Samurai Sword":{"Yellow":[44000006,81000001,141521202,262],"Orange":[355555556,700000001,1100000000,33],"Red":[1000000001,1814811077,7244077470,7]},"RPG Launcher":{"Yellow":[82054778,88000001,180000001,74],"Orange":[262500001,300003151,376665581,10]},"Naval Cutlass":{"Yellow":[50000001,79870871,155012778,287],"Orange":[337000001,551111112,800000000,42],"Red":[1670000001,2500000001,5714161670,7]},"Butterfly Knife":{"Yellow":[34861778,37206778,42000001,159],"Red":[305000001,377489255,777778671,3],"Orange":[105498778,106000001,158000001,29]},"MP5 Navy":{"Yellow":[26664778,32000001,153500001,288],"Orange":[107000001,155000001,252000001,58],"Red":[300229716,626000069,875183501,7]},"Bushmaster Carbon 15":{"Yellow":[29000001,37446357,160000001,319],"Orange":[125000234,175209676,238347784,69],"Red":[251111112,420000001,648000001,6]},"TMP":{"Yellow":[25000001,30000012,156600001,288],"Orange":[75555556,112378481,252000001,56],"Red":[916000001,1061377561,1307027978,7]},"Hammer":{"Yellow":[34872778,36886817,40000001,131],"Orange":[104401801,111305116,130600001,25]},"Bo Staff":{"Yellow":[34801011,35400001,37702015,123],"Orange":[105300001,151500001,180000001,16]},"M16 A2 Rifle":{"Yellow":[58000001,59000001,65000001,276],"Orange":[180000001,200000001,283224217,72],"Red":[944000001,1058298333,1152829018,5]},"Jackhammer":{"Orange":[226666667,339999001,600000001,57],"Yellow":[60000001,67000001,88000001,368]},"Springfield 1911":{"Red":[425000001,490000001,1266176691,7],"Yellow":[24000001,25019646,26425106,184],"Orange":[70532778,80031006,108000001,42]},"Crowbar":{"Orange":[106000001,141000001,177561293,30],"Yellow":[34500001,35149001,36100001,106],"Red":[450000001,748999001,1005000001,6]},"Katana":{"Orange":[301111134,400000001,700000001,42],"Yellow":[40050001,67777778,150000001,259],"Red":[1356016516,3000000001,6016006201,8]},"Scimitar":{"Orange":[114009010,155555556,450000001,34],"Yellow":[35344778,38500001,53927403,203]},"Ninja Claws":{"Yellow":[34661778,36000001,40000001,152],"Orange":[111616778,156600001,200000001,25]},"Kama":{"Yellow":[35000010,37500001,41794640,180],"Orange":[111305016,150000251,227000001,41]},"Leather Bullwhip":{"Yellow":[34800000,35461778,38960931,142],"Orange":[106500001,157000001,222222223,24]},"Dagger":{"Yellow":[35012778,36000001,41000001,147],"Orange":[104400001,132007004,191000001,34],"Red":[410000001,648323492,777777936,5]},"Knuckle Dusters":{"Yellow":[34700001,35350001,38000001,115],"Orange":[105498778,136600001,173549798,23],"Red":[505916001,614000001,906000001,4]},"Beretta 92FS":{"Yellow":[24800001,26000001,29000001,249],"Orange":[87111112,115555556,180000001,65],"Red":[430000001,1237000001,8958532501,12]},"Taurus":{"Yellow":[24000001,25100001,26300001,177],"Orange":[72000001,81057175,110000001,47]},"MP 40":{"Yellow":[25252526,28000001,143300346,285],"Red":[239900001,531213148,536618118,6],"Orange":[74600001,100000000,140000001,44]},"MP5k":{"Orange":[85555556,130978169,201710508,67],"Yellow":[25000002,30000101,200000001,311]},"Baseball Bat":{"Yellow":[35000001,37444445,40444445,169],"Orange":[104460001,111000001,152100001,34],"Red":[308691001,440000001,495888889,7]},"M4A1 Colt Carbine":{"Yellow":[58000001,58797631,62500001,230],"Orange":[174312778,188000001,258000001,64],"Red":[800000001,942000001,1767514833,10]},"AK-47":{"Orange":[186888001,222222223,298944734,64],"Yellow":[58000000,59000001,63700001,298],"Red":[1678052143,3000000001,3411000008,4]},"Thompson":{"Yellow":[25500001,30389000,141000002,227],"Orange":[75801652,117111112,225345001,44],"Red":[438669061,500000001,1155082853,4]},"Magnum":{"Yellow":[24215112,25300001,27346539,245],"Orange":[72222223,80000001,127557240,52],"Red":[344444445,520000077,999062379,16]},"Skorpion":{"Yellow":[25500001,34000001,225000001,245],"Orange":[106000001,210000001,334726369,40],"Red":[501111112,600000001,1484561259,8]},"Steyr AUG":{"Yellow":[58000001,59121778,64251778,271],"Orange":[175860001,195555556,260000001,55],"Red":[1000000001,1524997727,1560814068,5]},"S&W Revolver":{"Yellow":[23712778,25000001,26664778,189],"Orange":[76590001,99985100,156746576,46],"Red":[601572001,633551531,4510175123,5]},"Sawed-Off Shotgun":{"Yellow":[57720001,58975001,66258303,236],"Orange":[176998931,232000001,400000001,30],"Red":[802222223,1517501001,2100000001,4]},"Spear":{"Yellow":[34870001,36000001,39000001,143],"Orange":[105000001,120000000,156000001,16],"Red":[466577325,950000001,1188000001,7]},"Benelli M1 Tactical":{"Yellow":[57800001,58700001,63000001,286],"Orange":[181000001,255753251,355555556,57],"Red":[658633721,714225533,838626778,7]},"Lorcin 380":{"Orange":[70000001,78000001,112012778,46],"Yellow":[23800001,24800001,25800001,161],"Red":[401111113,433986212,1133372419,8]},"Wooden Nunchaku":{"Yellow":[34900001,35555556,39627001,116],"Orange":[107000001,155277778,274000100,24]},"Chain Whip":{"Yellow":[34800001,36000001,39777778,143],"Red":[601111112,668287434,691736285,5],"Orange":[106175085,122222223,166666667,27]},"Fiveseven":{"Yellow":[24800001,25863250,30000001,247],"Orange":[96754542,150000001,242228993,47]},"Axe":{"Orange":[147106659,210000001,501551829,23],"Yellow":[38706778,46300001,70000001,152]},"Stoner 96":{"Yellow":[90132001,101630001,173253749,112],"Orange":[410000001,480000001,555555556,10]},"Flail":{"Yellow":[35180836,37272782,42501000,181],"Orange":[115218778,190000001,266785947,33],"Red":[924000001,948747304,1227791858,4]},"SMAW Launcher":{"Orange":[239000001,244021778,2554000001,11],"Yellow":[81801656,85541778,153793895,94]},"Minigun":{"Yellow":[85000001,91987656,118000001,75],"Orange":[692222223,880750868,1464338501,5]},"PKM":{"Yellow":[82599931,88000001,142210130,68],"Orange":[272577180,370000001,600000000,7],"Red":[1456009270,1587879630,1760000001,5]},"Pen Knife":{"Yellow":[34321778,35461778,37898766,145],"Orange":[103809597,110012778,159300001,22],"Red":[555555810,626666555,634454772,6]},"Luger":{"Yellow":[23600001,25000000,25974001,191],"Orange":[72000001,83300001,138000001,30],"Red":[326000001,350000001,359066848,4]},"Guandao":{"Yellow":[35500001,38852001,50000001,226],"Orange":[129000001,174000001,301000001,32]},"Frying Pan":{"Yellow":[34601562,35400001,37444445,96],"Orange":[106200001,119988778,160000001,20]},"Milkor MGL":{"Yellow":[82600001,88000001,101644435,89],"Orange":[311419243,340000001,406000001,10]},"Sledgehammer":{"Yellow":[180000001,222235224,250000001,7]},"Rheinmetall MG 3":{"Yellow":[605260082,700311741,775725725,4]},"Bread Knife":{},"Poison Umbrella":{"Yellow":[462214212,501111112,546016516,10]},"Nock Gun":{"Yellow":[500000001,550000391,555555556,5]},"ID:76":{}};

    const BONUS_PRICES = {"Slow":{"Orange":[107000001,136000001,321000001,114],"Yellow":[28000000,35300001,62000001,393],"Red":[555555810,950000001,1260000001,11]},"Assassinate":{"Yellow":[26320001,58112778,75000004,627],"Orange":[136631317,257242501,501842486,152],"Red":[700000001,999062379,2000000001,26]},"Specialist":{"Yellow":[25300001,56886093,62843927,843],"Red":[385000001,433986212,1162236608,29],"Orange":[106200001,177311778,288888889,260]},"Motivation":{"Yellow":[25804778,31222223,44000001,909],"Red":[680000000,1000000001,1484561259,26],"Orange":[114000001,166250149,334223124,234]},"Deadeye":{"Yellow":[26675001,58000001,85000001,783],"Red":[610586839,1535804220,2717951676,13],"Orange":[76000001,171312778,300000001,155]},"Puncture":{"Yellow":[58291001,70000002,116000001,476],"Orange":[176000001,266000001,587668401,83],"Red":[500000001,1379446805,3000000001,10]},"Backstab":{"Yellow":[34800001,37356607,123000001,82],"Orange":[153900001,200020001,522000001,15]},"Wind-Up":{"Yellow":[35144778,37512778,44622645,311],"Orange":[108000001,159300001,240935235,65],"Red":[314085601,786607538,924000001,7]},"Warlord":{"Yellow":[152836274,185000001,255704278,1448],"Orange":[491000001,729000001,1051994201,144],"Red":[1110000001,2000000001,4350000001,8]},"Wither":{"Yellow":[25000001,28000001,37400001,671],"Orange":[103000001,133000001,213651216,182],"Red":[488000001,601572001,1266176691,14]},"Penetrate":{"Yellow":[58212778,90000001,210000001,482],"Orange":[175831778,275000001,502000001,83],"Red":[498233001,777777936,901000001,5]},"Bleed":{"Orange":[168313778,279568916,460000001,98],"Yellow":[40078171,61300001,106000001,457],"Red":[942693817,1123100001,3040618470,13]},"Irradiate":{"Yellow":[41965479,48677354,81000001,126],"Orange":[122222223,156000001,200000001,25]},"Rage":{"Yellow":[35500001,44000001,86514026,333],"Orange":[114409010,160000001,275000001,71],"Red":[515100004,599000003,1227791858,5]},"Eviscerate":{"Yellow":[53000002,63000010,101121112,557],"Orange":[220000001,355000001,650000001,83],"Red":[1517501001,1613185051,7220465622,5]},"Empower":{"Yellow":[37200001,51000001,200000001,409],"Orange":[113000000,180000142,505000000,63]},"Conserve":{"Yellow":[27000001,57165001,62700001,402],"Orange":[101056156,171100001,252912778,110],"Red":[400003812,720278931,1225000001,13]},"Quicken":{"Yellow":[26000001,30900001,46000489,758],"Orange":[101000001,130000001,215014781,186],"Red":[444444445,691736285,1160000001,12]},"Cupid":{"Yellow":[25000001,35400001,58900001,464],"Red":[455000001,571609010,904555556,13],"Orange":[102897001,174301656,257413456,98]},"Disarm":{"Yellow":[29000001,37806778,61111112,813],"Orange":[108000001,177000001,303000001,226],"Red":[421213253,668074371,949990001,29]},"Expose":{"Yellow":[28702640,57500001,63890910,853],"Orange":[105498778,192000001,400000001,217],"Red":[708960579,1160000001,1777700701,32]},"Bloodlust":{"Yellow":[41009899,68084663,110000000,160],"Orange":[305000001,505555556,833000001,22]},"Throttle":{"Orange":[104450001,171947797,259987592,76],"Yellow":[25804778,35000166,57000001,384],"Red":[405523392,514485001,1000000001,15]},"Powerful":{"Yellow":[37212122,60000001,87200001,1005],"Orange":[150000001,200000001,370000001,225],"Red":[511141112,701010012,1657000001,19]},"Paralyze":{"Yellow":[80501001,82590001,86800001,35]},"Suppress":{"Yellow":[83600001,88214778,101000001,47]},"Crusher":{"Yellow":[34800001,35500001,38706778,97],"Orange":[105498778,115555556,160000001,23]},"Weaken":{"Yellow":[57501001,60937081,83000088,549],"Orange":[180000001,257412778,375000001,123],"Red":[611214500,800000001,2560966844,11]},"Cripple":{"Orange":[198005211,260165152,356100001,62],"Yellow":[58212778,62521778,81200001,209],"Red":[771727501,1110000001,1200000001,8]},"Sure Shot":{"Orange":[179000001,266012778,673000001,67],"Yellow":[57809910,58899991,66200001,234],"Red":[905000001,1044444445,1330000001,9]},"Revitalize":{"Yellow":[190000001,240000001,376000001,504],"Orange":[658333335,1870000001,3500000001,57]},"Frenzy":{"Yellow":[35500001,40000001,82000001,323],"Orange":[119988778,180000001,409009010,65],"Red":[555556216,1066611775,2000000000,15]},"Roshambo":{"Yellow":[34501001,35280001,37233335,78],"Orange":[114300001,151500001,159300001,20]},"Plunder":{"Yellow":[42859848,60000001,155000001,594],"Orange":[184959708,278484792,628778048,92],"Red":[500000001,1055555556,1360000001,7]},"Comeback":{"Yellow":[25000000,26062827,30000001,225],"Orange":[75000001,100000001,154444445,39],"Red":[224012778,239900001,239975778,6]},"Fury":{"Yellow":[35344778,40750001,92000001,323],"Orange":[147000001,177500001,502000001,85],"Red":[770000001,955555773,1067318503,18]},"Execute":{"Red":[2660000001,3843741887,4510175123,12],"Yellow":[25241778,29000001,38000001,424],"Orange":[177072131,242228993,403525358,120]},"Achilles":{"Orange":[105498778,171495001,258000001,74],"Yellow":[25000001,35031601,58600001,447],"Red":[303491778,385000001,755555556,23]},"Proficience":{"Yellow":[36000001,44000001,51000001,279],"Orange":[142052533,222000001,321111112,64]},"Focus":{"Yellow":[58112778,60100001,80000001,262],"Orange":[180000001,250050001,415025785,67]},"Blindside":{"Yellow":[57600001,58551284,60000001,103],"Orange":[175500001,255753251,265500001,34]},"Parry":{"Yellow":[116600001,227000001,408723573,189],"Orange":[600000001,786220337,1620000001,28]},"Stun":{"Yellow":[37806778,58000001,65666778,285],"Orange":[171000001,186000001,300000001,53],"Red":[791000001,950000001,1480000001,12]},"Double-Tap":{"Yellow":[24000001,25200001,27800001,269],"Orange":[78000001,105498778,169900000,94],"Red":[390000001,750564001,3843741887,19]},"Double-Edged":{"Yellow":[34861778,36001375,38500001,92],"Orange":[124000001,159000001,185000001,20]},"Deadly":{"Orange":[193139931,264000001,381356637,43],"Yellow":[58000001,58608001,62100001,136]},"Grace":{"Yellow":[35144778,37512778,40897276,87],"Orange":[139632615,163000001,233700001,21]},"Berserk":{"Yellow":[35344778,37300001,40000001,86],"Orange":[113000001,160000001,260000001,23]},"Stricken":{"Yellow":[850000001,1000791637,1705555556,56],"Orange":[2554000001,3760000001,5012000001,6]},"HomeRun":{"Orange":[108108975,154171778,173502778,24],"Yellow":[35000001,36500001,50000001,119]},"Smurf":{"Yellow":[100000000,117100001,217548625,48],"Orange":[1919000001,2118160858,2347368381,8]},"Finale":{"Yellow":[82000001,85000001,90320001,66],"Orange":[300003151,319757865,343000001,8]},"Smash":{"Yellow":[180000001,222235224,250000001,7]},"Blindfire":{},"Lacerate":{},"Toxin":{"Yellow":[462214212,501111112,546016516,10]},"Hazardous":{"Yellow":[500000001,550000391,555555556,5]},"Freeze":{}};

    const CLASS_PRICES = {"Pistol / SMG":{"Orange":[80000001,117500001,230781010,1258],"Yellow":[25000000,27000001,42000001,5950],"Red":[385000090,575000001,1237000001,146]},"Shotgun / Rifle":{"Yellow":[58500001,63000001,122188419,6189],"Orange":[180000001,255000001,448000001,1069],"Red":[771727501,999000001,2000000001,101]},"Melee":{"Yellow":[35500001,42000001,100000001,6027],"Orange":[111600001,173549798,409009010,959],"Red":[500000001,855408084,1527437790,108]},"Heavy":{"Yellow":[82054778,89000980,125000001,847],"Orange":[260400001,350000001,588000001,98],"Red":[1111111112,1456009270,1760000001,14]}};

    const WEAPON_CLASS = {"AK74U":"Pistol / SMG","Enfield SA-80":"Shotgun / Rifle","SIG 552":"Shotgun / Rifle","USP":"Pistol / SMG","SKS Carbine":"Shotgun / Rifle","Cobra Derringer":"Pistol / SMG","Vektor CR-21":"Shotgun / Rifle","Macana":"Melee","Kodachi":"Melee","9mm Uzi":"Pistol / SMG","Heckler & Koch SL8":"Shotgun / Rifle","Type 98 Anti Tank":"Heavy","M249 SAW":"Heavy","Raven MP25":"Pistol / SMG","Desert Eagle":"Pistol / SMG","Ruger 57":"Pistol / SMG","ArmaLite M-15A4":"Shotgun / Rifle","Beretta M9":"Pistol / SMG","XM8 Rifle":"Shotgun / Rifle","Benelli M4 Super":"Shotgun / Rifle","Sai":"Melee","Swiss Army Knife":"Melee","Claymore Sword":"Melee","Yasukuni Sword":"Melee","Diamond Bladed Knife":"Melee","Metal Nunchaku":"Melee","Qsz-92":"Pistol / SMG","Kitchen Knife":"Melee","Mag 7":"Shotgun / Rifle","BT MP9":"Pistol / SMG","China Lake":"Heavy","Negev NG-5":"Heavy","Glock 17":"Pistol / SMG","Cricket Bat":"Melee","Blunderbuss":"Shotgun / Rifle","Ithaca 37":"Shotgun / Rifle","Tavor TAR-21":"Shotgun / Rifle","Samurai Sword":"Melee","RPG Launcher":"Heavy","Naval Cutlass":"Melee","Butterfly Knife":"Melee","TMP":"Pistol / SMG","Hammer":"Melee","Bo Staff":"Melee","M16 A2 Rifle":"Shotgun / Rifle","Jackhammer":"Shotgun / Rifle","Springfield 1911":"Pistol / SMG","Crowbar":"Melee","Katana":"Melee","Scimitar":"Melee","Ninja Claws":"Melee","Kama":"Melee","Leather Bullwhip":"Melee","Dagger":"Melee","Knuckle Dusters":"Melee","Beretta 92FS":"Pistol / SMG","Taurus":"Pistol / SMG","MP 40":"Pistol / SMG","MP5k":"Pistol / SMG","Baseball Bat":"Melee","M4A1 Colt Carbine":"Shotgun / Rifle","AK-47":"Shotgun / Rifle","Thompson":"Pistol / SMG","Magnum":"Pistol / SMG","Skorpion":"Pistol / SMG","Steyr AUG":"Shotgun / Rifle","S&W Revolver":"Pistol / SMG","Sawed-Off Shotgun":"Shotgun / Rifle","Spear":"Melee","Benelli M1 Tactical":"Shotgun / Rifle","Lorcin 380":"Pistol / SMG","Wooden Nunchaku":"Melee","Chain Whip":"Melee","Fiveseven":"Pistol / SMG","Axe":"Melee","Stoner 96":"Heavy","Flail":"Melee","SMAW Launcher":"Heavy","Minigun":"Heavy","PKM":"Heavy","Pen Knife":"Melee","Luger":"Pistol / SMG","Guandao":"Melee","Frying Pan":"Melee","Milkor MGL":"Heavy","Sledgehammer":"Melee","Rheinmetall MG 3":"Heavy","Bread Knife":"Melee","Poison Umbrella":"Melee","Nock Gun":"Shotgun / Rifle","Bushmaster Carbon 15":"Pistol / SMG","Snow Cannon":"Heavy","Twin Tiger Hooks":"Melee","Wushu Double Axes":"Melee","Pair of Ice Skates":"Melee","Diamond Icicle":"Melee","Dual Bushmasters":"Pistol / SMG","Dual MP5s":"Pistol / SMG","Dual P90s":"Pistol / SMG","Dual TMPs":"Pistol / SMG","Dual Uzis":"Pistol / SMG","Dual Samurai Swords":"Melee","Dual Scimitars":"Melee","Gold Plated AK-47":"Shotgun / Rifle","Devil's Pitchfork":"Melee","Golden Broomstick":"Melee","Handbag":"Melee","Madball":"Melee","Pair of High Heels":"Melee","Petrified Humerus":"Melee","Pillow":"Melee","Plastic Sword":"Melee","Slingshot":"Pistol / SMG","Wand of Destruction":"Melee"};

    const BONUS_ID_MAP = {"1":"Expose","14":"Proficience","20":"Stricken","21":"Plunder","33":"Blindfire","34":"Hazardous","35":"Spray","36":"Demoralize","37":"Storage","38":"Freeze","41":"Revitalize","42":"Wither","43":"Roshambo","44":"Slow","45":"Cripple","46":"Weaken","47":"Cupid","48":"Throttle","49":"Crusher","50":"Achilles","51":"Blindside","52":"Backstab","53":"Grace","54":"Berserk","55":"Conserve","56":"Eviscerate","57":"Bleed","58":"Stun","59":"Paralyze","60":"Suppress","61":"Motivation","62":"Deadly","63":"Deadeye","64":"Fury","65":"Rage","66":"Puncture","67":"Comeback","68":"Powerful","71":"Specialist","72":"Assassinate","73":"Smurf","74":"Double-Edged","75":"Execute","76":"Wind-Up","78":"Sure Shot","79":"Focus","80":"Frenzy","81":"Warlord","82":"Finale","83":"HomeRun","84":"Parry","85":"Bloodlust","86":"Disarm","87":"Empower","88":"Quicken","89":"Lacerate","101":"Penetrate","102":"Irradiate","103":"Toxin","104":"Smash","105":"Double-Tap","120":"Shock"};

    const ITEM_ID_MAP = {"1":"Hammer","2":"Baseball Bat","3":"Crowbar","4":"Knuckle Dusters","5":"Pen Knife","6":"Kitchen Knife","7":"Dagger","8":"Axe","9":"Scimitar","11":"Samurai Sword","12":"Glock 17","13":"Raven MP25","14":"Ruger 57","15":"Beretta M9","16":"USP","17":"Beretta 92FS","18":"Fiveseven","19":"Magnum","20":"Desert Eagle","22":"Sawed-Off Shotgun","23":"Benelli M1 Tactical","24":"MP5 Navy","25":"P90","26":"AK-47","27":"M4A1 Colt Carbine","28":"Benelli M4 Super","29":"M16 A2 Rifle","30":"Steyr AUG","31":"M249 SAW","63":"Minigun","76":"Snow Cannon","99":"Springfield 1911","100":"Egg Propelled Launcher","108":"9mm Uzi","109":"RPG Launcher","110":"Leather Bullwhip","111":"Ninja Claws","146":"Yasukuni Sword","170":"Wand of Destruction","173":"Butterfly Knife","174":"XM8 Rifle","177":"Cobra Derringer","189":"S&W Revolver","217":"Claymore Sword","219":"Enfield SA-80","223":"Jackhammer","224":"Swiss Army Knife","225":"Mag 7","227":"Spear","228":"Vektor CR-21","231":"Heckler & Koch SL8","233":"BT MP9","234":"Chain Whip","235":"Wooden Nunchaku","236":"Kama","237":"Kodachi","238":"Sai","240":"Type 98 Anti Tank","241":"Bushmaster Carbon 15","243":"Taurus","245":"Bo Staff","247":"Katana","248":"Qsz-92","249":"SKS Carbine","250":"Twin Tiger Hooks","251":"Wushu Double Axes","252":"Ithaca 37","253":"Lorcin 380","254":"S&W M29","289":"Dual Axes","290":"Dual Hammers","291":"Dual Scimitars","292":"Dual Samurai Swords","346":"Pair of High Heels","382":"Gold Plated AK-47","387":"Handbag","391":"Macana","393":"Slingshot","395":"Metal Nunchaku","397":"Flail","398":"SIG 552","399":"ArmaLite M-15A4","400":"Guandao","402":"Ice Pick","438":"Cricket Bat","439":"Frying Pan","440":"Pillow","483":"MP5k","484":"AK74U","485":"Skorpion","486":"TMP","487":"Thompson","488":"MP 40","489":"Luger","490":"Blunderbuss","545":"Dual TMPs","546":"Dual Bushmasters","547":"Dual MP5s","548":"Dual P90s","549":"Dual Uzis","599":"Golden Broomstick","600":"Devil's Pitchfork","604":"Pair of Ice Skates","605":"Diamond Icicle","612":"Tavor TAR-21","613":"Harpoon","614":"Diamond Bladed Knife","615":"Naval Cutlass","632":"Petrified Humerus","790":"Plastic Sword","830":"Nock Gun","831":"Beretta Pico","832":"Riding Crop","837":"Rheinmetall MG 3","838":"Homemade Pocket Shotgun","839":"Madball","846":"Scalpel","850":"Sledgehammer","1053":"Bread Knife","1055":"Poison Umbrella","1152":"SMAW Launcher","1153":"China Lake","1154":"Milkor MGL","1155":"PKM","1156":"Negev NG-5","1157":"Stoner 96","1158":"Meat Hook","1159":"Cleaver","1231":"Golf Club","1255":"Bone Saw","1257":"Cattle Prod","1456":"Bolas"};

    // ─── Embedded Armour Price Data ──────────────────────────

    const ARMOUR_PRICES = {"Riot Pants": {"Yellow": [75008802, 93717172, 122222223, 2837]}, "Assault Gloves": {"Yellow": [109000001, 129000001, 175000000, 3079]}, "Dune Helmet": {"Yellow": [70700001, 81780001, 102000001, 2492]}, "Riot Gloves": {"Yellow": [74412778, 90000001, 113498767, 2595]}, "Assault Pants": {"Yellow": [180000001, 215000001, 291388688, 3275]}, "Sentinel Apron": {"Orange": [4000000001, 4360000001, 4910000001, 205]}, "Assault Body": {"Yellow": [224800061, 275000001, 381808057, 3507]}, "Delta Boots": {"Orange": [400174273, 500000001, 700147109, 431]}, "Vanguard Body": {"Orange": [3019395964, 3300000001, 3751250001, 252]}, "Vanguard Respirator": {"Orange": [4226320803, 4610555556, 5112005780, 178]}, "Vanguard Gloves": {"Orange": [1611027778, 1731527500, 2000000001, 222]}, "Marauder Pants": {"Orange": [726161613, 926198753, 1115216208, 297]}, "Assault Boots": {"Yellow": [120118070, 145000001, 197993158, 3088]}, "Sentinel Boots": {"Orange": [2016190641, 2250000001, 2525000001, 197]}, "Dune Vest": {"Yellow": [72000001, 87283839, 111737272, 2757]}, "Dune Gloves": {"Yellow": [71000001, 83000001, 101549209, 2158]}, "Dune Boots": {"Yellow": [71000000, 83000000, 100019123, 2365]}, "Riot Boots": {"Yellow": [75000001, 90003309, 111000001, 2728]}, "Riot Body": {"Yellow": [80000001, 104482812, 155661606, 3003]}, "Sentinel Pants": {"Orange": [2500000001, 2770628104, 3100000001, 255]}, "Riot Helmet": {"Yellow": [98000001, 122495620, 160000001, 3038]}, "Delta Body": {"Orange": [623000001, 833333334, 1166777889, 425]}, "Vanguard Pants": {"Orange": [2012908251, 2333166667, 2681165614, 250]}, "Vanguard Boots": {"Orange": [1630521056, 1755122001, 1897500001, 242]}, "Assault Helmet": {"Yellow": [90000652, 105000001, 143161735, 3319]}, "Dune Pants": {"Yellow": [71111112, 84000001, 102000001, 2507]}, "Delta Gas Mask": {"Orange": [1455773798, 1824041897, 2500038498, 392]}, "Marauder Face Mask": {"Orange": [1300991306, 1452111113, 1655303704, 279]}, "Marauder Boots": {"Orange": [703000104, 800000001, 1000000001, 269]}, "Delta Pants": {"Orange": [430000001, 508723474, 651386759, 462]}, "Delta Gloves": {"Orange": [348998333, 436013787, 600550301, 455]}, "EOD Helmet": {"Red": [7011111112, 7950000001, 8750000001, 69]}, "EOD Gloves": {"Red": [4022886960, 4555555668, 5196386465, 67]}, "Marauder Body": {"Orange": [1333517031, 1501000001, 1857274663, 284]}, "Marauder Gloves": {"Orange": [455555556, 534875254, 666500000, 366]}, "EOD Apron": {"Red": [9011111112, 10010000001, 12322890145, 61]}, "Sentinel Helmet": {"Orange": [2459705688, 2749950001, 3065920139, 256]}, "EOD Pants": {"Red": [6312595746, 7009501229, 7613198123, 78]}, "EOD Boots": {"Red": [4233773259, 4629834818, 5013250001, 80]}, "Sentinel Gloves": {"Orange": [1822222223, 2000000001, 2152777778, 275]}, "Hazmat Suit": {"Yellow": [6511830001, 7900830606, 8100125180, 35]}, "M'aol Hooves": {"Yellow": [2501835586, 2501835586, 2501835586, 1]}, "M'aol Visage": {"Yellow": [7931234196, 7931234196, 7931234196, 1]}};

    const ARMOUR_BONUS_PRICES = {"Impregnable": {"Yellow": [78985947, 99150001, 143051066, 14201]}, "Impenetrable": {"Yellow": [120000000, 180000000, 255000001, 16268]}, "Insurmountable": {"Yellow": [71012778, 84000001, 105000001, 12279]}, "Immutable": {"Orange": [2128869886, 2606777778, 3337500000, 1188]}, "Invulnerable": {"Orange": [449000001, 623000001, 1326501656, 2165]}, "Irrepressible": {"Orange": [1800000001, 2435670187, 3455981721, 1144]}, "Imperviable": {"Orange": [670950017, 1010483303, 1417074895, 1495]}, "Impassable": {"Red": [4800000001, 6500000287, 8537651251, 355]}, "Radiation Protection": {"Yellow": [6511830001, 7900830606, 8100125180, 35]}, "Kinetokinesis": {"Yellow": [3859185238, 5216534891, 6573884543, 2]}};

    const ARMOUR_SET_PRICES = {"Riot": {"Yellow": [78985947, 99150001, 143051066, 14201]}, "Assault": {"Yellow": [120000000, 180000000, 255000001, 16268]}, "Dune": {"Yellow": [71012778, 84000001, 105000001, 12279]}, "Sentinel": {"Orange": [2128869886, 2606777778, 3337500000, 1188]}, "Delta": {"Orange": [449000001, 623000001, 1326501656, 2165]}, "Vanguard": {"Orange": [1800000001, 2435670187, 3455981721, 1144]}, "Marauder": {"Orange": [670950017, 1010483303, 1417074895, 1495]}, "EOD": {"Red": [4800000001, 6500000287, 8537651251, 355]}, "Other": {"Yellow": [6511830001, 7900830606, 8100125180, 35]}, "M'aol": {"Yellow": [3859185238, 5216534891, 6573884543, 2]}};

    const ARMOUR_SET = {"M'aol Visage": "M'aol", "M'aol Hooves": "M'aol", "Sentinel Helmet": "Sentinel", "Sentinel Apron": "Sentinel", "Sentinel Pants": "Sentinel", "Sentinel Boots": "Sentinel", "Sentinel Gloves": "Sentinel", "Vanguard Respirator": "Vanguard", "Vanguard Body": "Vanguard", "Vanguard Pants": "Vanguard", "Vanguard Boots": "Vanguard", "Vanguard Gloves": "Vanguard", "Flak Jacket": "Other", "Hazmat Suit": "Other", "Kevlar Gloves": "Other", "WWII Helmet": "Other", "Motorcycle Helmet": "Other", "Construction Helmet": "Other", "Welding Helmet": "Other", "Riot Helmet": "Riot", "Riot Body": "Riot", "Riot Pants": "Riot", "Riot Boots": "Riot", "Riot Gloves": "Riot", "Dune Helmet": "Dune", "Dune Vest": "Dune", "Dune Pants": "Dune", "Dune Boots": "Dune", "Dune Gloves": "Dune", "Assault Helmet": "Assault", "Assault Body": "Assault", "Assault Pants": "Assault", "Assault Boots": "Assault", "Assault Gloves": "Assault", "Delta Gas Mask": "Delta", "Delta Body": "Delta", "Delta Pants": "Delta", "Delta Boots": "Delta", "Delta Gloves": "Delta", "Marauder Face Mask": "Marauder", "Marauder Body": "Marauder", "Marauder Pants": "Marauder", "Marauder Boots": "Marauder", "Marauder Gloves": "Marauder", "EOD Helmet": "EOD", "EOD Apron": "EOD", "EOD Pants": "EOD", "EOD Boots": "EOD", "EOD Gloves": "EOD"};

    const ARMOUR_ID_MAP = {"1164": "M'aol Visage", "1167": "M'aol Hooves", "1307": "Sentinel Helmet", "1308": "Sentinel Apron", "1309": "Sentinel Pants", "1310": "Sentinel Boots", "1311": "Sentinel Gloves", "1355": "Vanguard Respirator", "1356": "Vanguard Body", "1357": "Vanguard Pants", "1358": "Vanguard Boots", "1359": "Vanguard Gloves", "178": "Flak Jacket", "348": "Hazmat Suit", "640": "Kevlar Gloves", "641": "WWII Helmet", "642": "Motorcycle Helmet", "643": "Construction Helmet", "644": "Welding Helmet", "655": "Riot Helmet", "656": "Riot Body", "657": "Riot Pants", "658": "Riot Boots", "659": "Riot Gloves", "660": "Dune Helmet", "661": "Dune Vest", "662": "Dune Pants", "663": "Dune Boots", "664": "Dune Gloves", "665": "Assault Helmet", "666": "Assault Body", "667": "Assault Pants", "668": "Assault Boots", "669": "Assault Gloves", "670": "Delta Gas Mask", "671": "Delta Body", "672": "Delta Pants", "673": "Delta Boots", "674": "Delta Gloves", "675": "Marauder Face Mask", "676": "Marauder Body", "677": "Marauder Pants", "678": "Marauder Boots", "679": "Marauder Gloves", "680": "EOD Helmet", "681": "EOD Apron", "682": "EOD Pants", "683": "EOD Boots", "684": "EOD Gloves"};

    const ARMOUR_BONUS_MAP = {"112": "Kinetokinesis", "115": "Immutable", "121": "Irrepressible", "15": "Impregnable", "17": "Impenetrable", "22": "Imperviable", "26": "Impassable", "90": "Radiation Protection", "91": "Invulnerable", "92": "Insurmountable"};

    // ─── Constants ───────────────────────────────────────────

    const POS_KEY     = 'rwp_panel_pos';
    const CLOSED_KEY  = 'rwp_panel_closed';
    const TAB_KEY     = 'rwp_active_tab';
    const MODE_KEY    = 'rwp_mode';
    const color       = '#e8c44a';
    const CLASSES     = ['Pistol / SMG', 'Melee', 'Shotgun / Rifle', 'Heavy'];
    const ARMOUR_SETS = ['Dune', 'Riot', 'Assault', 'Delta', 'Marauder', 'Sentinel', 'Vanguard', 'EOD', "M'aol", 'Other'];
    const RARITIES    = ['Yellow', 'Orange', 'Red'];
    const RARITY_COLORS = { Yellow: '#e8c44a', Orange: '#ff9933', Red: '#ff4444' };
    const ARMOUR_SET_SHORT = { Dune: 'Dun', Riot: 'Riot', Assault: 'Aslt', Delta: 'Del', Marauder: 'Mar', Sentinel: 'Sen', Vanguard: 'Van', EOD: 'EOD', "M'aol": "M'aol", Other: 'Oth' };

    let panelClosed = false;

    // ─── Settings helpers ────────────────────────────────────

    function getStored(key, fallback) {
        try { return GM_getValue(key, fallback); } catch (_) {
            const v = localStorage.getItem(key);
            if (v === null) return fallback;
            try { return JSON.parse(v); } catch (__) { return v; }
        }
    }

    function setStored(key, val) {
        try { GM_setValue(key, val); } catch (_) {
            localStorage.setItem(key, JSON.stringify(val));
        }
    }

    // ─── Money formatting ────────────────────────────────────

    function fmtMoney(n) {
        if (n == null) return 'N/A';
        if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
        return '$' + n.toLocaleString();
    }

    // ─── Data helpers ────────────────────────────────────────

    function getWeaponsByClass(cls) {
        if (!cls) return Object.keys(WEAPON_PRICES).sort();
        return Object.keys(WEAPON_PRICES)
            .filter(w => WEAPON_CLASS[w] === cls)
            .sort();
    }

    function getBonusNames() {
        return Object.keys(BONUS_PRICES).sort();
    }

    function getArmoursBySet(set) {
        if (!set) return Object.keys(ARMOUR_PRICES).sort();
        return Object.keys(ARMOUR_PRICES)
            .filter(a => ARMOUR_SET[a] === set)
            .sort();
    }

    function getArmourBonusNames() {
        return Object.keys(ARMOUR_BONUS_PRICES).sort();
    }

    // ─── Inject CSS ──────────────────────────────────────────

    const style = document.createElement('style');
    style.textContent = `
.rwp-panel {
    position: fixed;
    z-index: 999999;
    background: rgba(11, 15, 25, 0.96);
    border: 1px solid ${color};
    border-radius: 6px;
    padding: 0;
    color: #ccc;
    font-size: 12px;
    font-family: Verdana, Arial, sans-serif;
    width: 380px;
    max-height: 85vh;
    box-shadow: 0 0 8px rgba(0,0,0,0.7);
    display: flex;
    flex-direction: column;
}
.rwp-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: bold;
    padding: 6px 8px;
    cursor: move;
    border-bottom: 1px solid ${color};
    color: ${color};
    position: relative;
    z-index: 1000000;
    pointer-events: auto;
}
.rwp-title-text {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
}
.rwp-buttons {
    flex-shrink: 0;
    cursor: default;
    display: flex;
    gap: 3px;
}
.rwp-btn {
    padding: 1px 5px;
    font-size: 10px;
    background: transparent;
    color: ${color};
    border: 1px solid ${color};
    border-radius: 3px;
    cursor: pointer;
    min-width: 26px;
    text-align: center;
}
.rwp-btn:hover {
    background: rgba(232, 196, 74, 0.15);
}
.rwp-tabs {
    display: flex;
    border-bottom: 1px solid rgba(232, 196, 74, 0.3);
}
.rwp-tab {
    flex: 1;
    text-align: center;
    padding: 5px 4px;
    cursor: pointer;
    font-size: 10px;
    font-weight: 700;
    color: #888;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
}
.rwp-tab:hover {
    color: #bbb;
}
.rwp-tab.active {
    color: ${color};
    border-bottom-color: ${color};
}
.rwp-body {
    padding: 8px;
    overflow-y: auto;
    flex: 1;
}
.rwp-select {
    width: 100%;
    background: rgba(20, 25, 40, 0.9);
    border: 1px solid rgba(232, 196, 74, 0.4);
    color: #ddd;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 11px;
    font-family: Verdana, Arial, sans-serif;
    margin-bottom: 6px;
    box-sizing: border-box;
}
.rwp-select:focus {
    outline: none;
    border-color: ${color};
}
.rwp-label {
    font-size: 10px;
    color: #999;
    margin-bottom: 2px;
    display: block;
}
.rwp-result {
    margin-top: 8px;
    padding: 8px;
    background: rgba(232, 196, 74, 0.06);
    border: 1px solid rgba(232, 196, 74, 0.2);
    border-radius: 5px;
}
.rwp-result-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 0;
    font-size: 11px;
}
.rwp-result-label {
    color: #999;
}
.rwp-result-value {
    font-weight: 700;
}
.rwp-estimate {
    margin-top: 8px;
    padding: 8px;
    background: rgba(232, 196, 74, 0.12);
    border: 1px solid ${color};
    border-radius: 5px;
    text-align: center;
}
.rwp-estimate-title {
    font-size: 10px;
    color: ${color};
    font-weight: 700;
    margin-bottom: 4px;
}
.rwp-estimate-range {
    font-size: 14px;
    font-weight: 700;
    color: #fff;
}
.rwp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
}
.rwp-table th {
    text-align: left;
    color: ${color};
    font-weight: 700;
    padding: 3px 4px;
    border-bottom: 1px solid rgba(232, 196, 74, 0.3);
    position: sticky;
    top: 0;
    background: rgba(11, 15, 25, 0.96);
}
.rwp-table td {
    padding: 3px 4px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
}
.rwp-table tr:hover td {
    background: rgba(232, 196, 74, 0.05);
}
.rwp-count {
    font-size: 9px;
    color: #666;
}
.rwp-mode-bar {
    display: flex;
    border-bottom: 1px solid rgba(232, 196, 74, 0.3);
}
.rwp-mode-btn {
    flex: 1;
    text-align: center;
    padding: 5px 4px;
    cursor: pointer;
    font-size: 10px;
    font-weight: 700;
    color: #888;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    font-family: Verdana, Arial, sans-serif;
}
.rwp-mode-btn:hover {
    color: #bbb;
}
.rwp-mode-btn.active {
    color: ${color};
    border-bottom-color: ${color};
    background: rgba(232, 196, 74, 0.08);
}
`;
    document.head.appendChild(style);

    // ─── Draggable ───────────────────────────────────────────

    function makeDraggable(element, handle) {
        let isDown = false;
        let startX = 0, startY = 0;
        let startLeft = 0, startTop = 0;

        function startDrag(clientX, clientY) {
            isDown = true;
            const rect = element.getBoundingClientRect();
            element.style.left   = rect.left + 'px';
            element.style.top    = rect.top + 'px';
            element.style.right  = 'auto';
            element.style.bottom = 'auto';
            startX = clientX;
            startY = clientY;
            startLeft = rect.left;
            startTop  = rect.top;
            document.body.style.userSelect = 'none';
        }

        function moveDrag(clientX, clientY) {
            element.style.left = (startLeft + (clientX - startX)) + 'px';
            element.style.top  = (startTop  + (clientY - startY)) + 'px';
        }

        function endDrag() {
            isDown = false;
            document.body.style.userSelect = '';
            try {
                const rect = element.getBoundingClientRect();
                localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
            } catch (e) {}
        }

        handle.addEventListener('mousedown', (e) => {
            if (e.target && e.target.classList.contains('rwp-btn')) return;
            e.preventDefault();
            startDrag(e.clientX, e.clientY);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            moveDrag(e.clientX, e.clientY);
        }, { passive: false });

        document.addEventListener('mouseup', () => {
            if (!isDown) return;
            endDrag();
        });

        handle.addEventListener('touchstart', (e) => {
            if (e.target && e.target.classList.contains('rwp-btn')) return;
            const t = e.touches[0];
            if (!t) return;
            e.preventDefault();
            startDrag(t.clientX, t.clientY);
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!isDown) return;
            const t = e.touches[0];
            if (!t) return;
            e.preventDefault();
            moveDrag(t.clientX, t.clientY);
        }, { passive: false });

        document.addEventListener('touchend', () => {
            if (!isDown) return;
            endDrag();
        });
    }

    // ─── Panel creation ──────────────────────────────────────

    function createPanel() {
        if (document.getElementById('rwp-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'rwp-panel';
        panel.className = 'rwp-panel';

        try {
            const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
            if (saved && typeof saved.top === 'number' && typeof saved.left === 'number') {
                panel.style.left = saved.left + 'px';
                panel.style.top  = saved.top + 'px';
            } else {
                panel.style.top = '80px';
                panel.style.right = '20px';
            }
        } catch(e) {
            panel.style.top = '80px';
            panel.style.right = '20px';
        }

        const activeTab = getStored(TAB_KEY, 0);
        const activeMode = getStored(MODE_KEY, 'weapon');
        const refLabel = activeMode === 'armour' ? 'Armour Ref' : 'Weapon Ref';

        panel.innerHTML =
            '<div class="rwp-title">' +
                '<span class="rwp-title-text">RW Weapon Pricer</span>' +
                '<span class="rwp-buttons">' +
                    '<button id="rwp-refresh-btn" class="rwp-btn" title="Reset">↻</button>' +
                    '<button id="rwp-close-btn" class="rwp-btn" title="Close">✖</button>' +
                '</span>' +
            '</div>' +
            '<div class="rwp-mode-bar">' +
                '<button class="rwp-mode-btn' + (activeMode === 'weapon' ? ' active' : '') + '" data-mode="weapon">\u2694 Weapons</button>' +
                '<button class="rwp-mode-btn' + (activeMode === 'armour' ? ' active' : '') + '" data-mode="armour">\uD83D\uDEE1 Armour</button>' +
            '</div>' +
            '<div class="rwp-tabs">' +
                '<div class="rwp-tab' + (activeTab === 0 ? ' active' : '') + '" data-tab="0">Calculator</div>' +
                '<div class="rwp-tab' + (activeTab === 1 ? ' active' : '') + '" data-tab="1">Bonus Ref</div>' +
                '<div class="rwp-tab' + (activeTab === 2 ? ' active' : '') + '" data-tab="2">' + refLabel + '</div>' +
            '</div>' +
            '<div class="rwp-body" id="rwp-body"></div>';

        document.body.appendChild(panel);
        makeDraggable(panel, panel.querySelector('.rwp-title'));
        wirePanel(panel, activeTab);
    }

    // ─── Panel wiring ────────────────────────────────────────

    function wirePanel(panel, initialTab) {
        const closeBtn   = panel.querySelector('#rwp-close-btn');
        const refreshBtn = panel.querySelector('#rwp-refresh-btn');
        const tabs       = panel.querySelectorAll('.rwp-tab');
        const modeBtns   = panel.querySelectorAll('.rwp-mode-btn');
        const body       = panel.querySelector('#rwp-body');

        closeBtn.addEventListener('click', () => {
            panel.remove();
            panelClosed = true;
        });

        refreshBtn.addEventListener('click', () => {
            renderTab(body, getCurrentTab(), getCurrentMode());
        });

        function getCurrentTab() {
            const active = panel.querySelector('.rwp-tab.active');
            return active ? parseInt(active.dataset.tab) : 0;
        }

        function getCurrentMode() {
            const active = panel.querySelector('.rwp-mode-btn.active');
            return active ? active.dataset.mode : 'weapon';
        }

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                modeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = btn.dataset.mode;
                setStored(MODE_KEY, mode);
                // Update third tab label
                const tab2 = panel.querySelector('.rwp-tab[data-tab="2"]');
                if (tab2) tab2.textContent = mode === 'armour' ? 'Armour Ref' : 'Weapon Ref';
                renderTab(body, getCurrentTab(), mode);
            });
        });

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const idx = parseInt(tab.dataset.tab);
                setStored(TAB_KEY, idx);
                renderTab(body, idx, getCurrentMode());
            });
        });

        renderTab(body, initialTab, getStored(MODE_KEY, 'weapon'));
    }

    function renderTab(body, idx, mode) {
        body.innerHTML = '';
        if (mode === 'armour') {
            if (idx === 0) renderArmourCalculator(body);
            else if (idx === 1) renderArmourBonusRef(body);
            else if (idx === 2) renderArmourRef(body);
        } else {
            if (idx === 0) renderCalculator(body);
            else if (idx === 1) renderBonusRef(body);
            else if (idx === 2) renderWeaponRef(body);
        }
    }

    // ─── Tab 1: Calculator ───────────────────────────────────

    function renderCalculator(container) {
        // Class select
        const classLabel = document.createElement('span');
        classLabel.className = 'rwp-label';
        classLabel.textContent = 'Weapon Class';
        container.appendChild(classLabel);

        const classSelect = document.createElement('select');
        classSelect.className = 'rwp-select';
        classSelect.innerHTML = '<option value="">All Classes</option>' +
            CLASSES.map(c => '<option value="' + c + '">' + c + '</option>').join('');
        container.appendChild(classSelect);

        // Weapon select
        const weaponLabel = document.createElement('span');
        weaponLabel.className = 'rwp-label';
        weaponLabel.textContent = 'Weapon';
        container.appendChild(weaponLabel);

        const weaponSelect = document.createElement('select');
        weaponSelect.className = 'rwp-select';
        container.appendChild(weaponSelect);

        function populateWeapons() {
            const cls = classSelect.value;
            const weapons = getWeaponsByClass(cls || null);
            weaponSelect.innerHTML = '<option value="">-- Select Weapon --</option>' +
                weapons.map(w => '<option value="' + w.replace(/"/g, '&quot;') + '">' + w + '</option>').join('');
        }
        populateWeapons();

        // Quality select
        const qualLabel = document.createElement('span');
        qualLabel.className = 'rwp-label';
        qualLabel.textContent = 'Quality';
        container.appendChild(qualLabel);

        const qualSelect = document.createElement('select');
        qualSelect.className = 'rwp-select';
        RARITIES.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            opt.style.color = RARITY_COLORS[r];
            qualSelect.appendChild(opt);
        });
        qualSelect.value = 'Orange';
        container.appendChild(qualSelect);

        // Bonus 1
        const bonus1Label = document.createElement('span');
        bonus1Label.className = 'rwp-label';
        bonus1Label.textContent = 'Bonus 1';
        container.appendChild(bonus1Label);

        const bonus1Select = document.createElement('select');
        bonus1Select.className = 'rwp-select';
        const bonusNames = getBonusNames();
        bonus1Select.innerHTML = '<option value="">None</option>' +
            bonusNames.map(b => '<option value="' + b + '">' + b + '</option>').join('');
        container.appendChild(bonus1Select);

        // Bonus 2
        const bonus2Label = document.createElement('span');
        bonus2Label.className = 'rwp-label';
        bonus2Label.textContent = 'Bonus 2';
        container.appendChild(bonus2Label);

        const bonus2Select = document.createElement('select');
        bonus2Select.className = 'rwp-select';
        bonus2Select.innerHTML = '<option value="">None</option>' +
            bonusNames.map(b => '<option value="' + b + '">' + b + '</option>').join('');
        container.appendChild(bonus2Select);

        // Result area
        const resultDiv = document.createElement('div');
        resultDiv.id = 'rwp-result-area';
        container.appendChild(resultDiv);

        function updateBonus2State() {
            if (qualSelect.value === 'Yellow') {
                bonus2Select.value = '';
                bonus2Select.disabled = true;
                bonus2Select.style.opacity = '0.4';
            } else {
                bonus2Select.disabled = false;
                bonus2Select.style.opacity = '1';
            }
        }

        function updateResults() {
            updateBonus2State();
            const weapon  = weaponSelect.value;
            const rarity  = qualSelect.value;
            const bonus1  = bonus1Select.value;
            const bonus2  = bonus2Select.value;
            const cls     = classSelect.value || (weapon ? WEAPON_CLASS[weapon] : null);

            resultDiv.innerHTML = '';

            if (!rarity) return;

            const resultBox = document.createElement('div');
            resultBox.className = 'rwp-result';

            // Class baseline
            if (cls && CLASS_PRICES[cls] && CLASS_PRICES[cls][rarity]) {
                const cd = CLASS_PRICES[cls][rarity];
                resultBox.innerHTML +=
                    '<div class="rwp-result-row">' +
                        '<span class="rwp-result-label">' + cls + ' class median</span>' +
                        '<span class="rwp-result-value" style="color:' + RARITY_COLORS[rarity] + '">' + fmtMoney(cd[1]) + '</span>' +
                    '</div>';
            }

            // Weapon specific
            let wData = null;
            if (weapon && WEAPON_PRICES[weapon] && WEAPON_PRICES[weapon][rarity]) {
                wData = WEAPON_PRICES[weapon][rarity];
                resultBox.innerHTML +=
                    '<div style="margin-top:6px;font-size:10px;color:' + color + ';font-weight:700;">' + weapon + ' (' + rarity + ')</div>' +
                    '<div class="rwp-result-row">' +
                        '<span class="rwp-result-label">P25 (Low)</span>' +
                        '<span class="rwp-result-value">' + fmtMoney(wData[0]) + '</span>' +
                    '</div>' +
                    '<div class="rwp-result-row">' +
                        '<span class="rwp-result-label">Median</span>' +
                        '<span class="rwp-result-value" style="color:' + RARITY_COLORS[rarity] + '">' + fmtMoney(wData[1]) + '</span>' +
                    '</div>' +
                    '<div class="rwp-result-row">' +
                        '<span class="rwp-result-label">P75 (High)</span>' +
                        '<span class="rwp-result-value">' + fmtMoney(wData[2]) + '</span>' +
                    '</div>' +
                    '<div class="rwp-result-row">' +
                        '<span class="rwp-result-label">Sales</span>' +
                        '<span class="rwp-count">' + wData[3] + ' auctions</span>' +
                    '</div>';
            } else if (weapon) {
                resultBox.innerHTML +=
                    '<div style="margin-top:6px;font-size:10px;color:#888;">No ' + rarity + ' data for ' + weapon + ' — using class data</div>';
            }

            // Bonus data
            [bonus1, bonus2].forEach((b, i) => {
                if (!b) return;
                if (BONUS_PRICES[b] && BONUS_PRICES[b][rarity]) {
                    const bd = BONUS_PRICES[b][rarity];
                    resultBox.innerHTML +=
                        '<div style="margin-top:6px;font-size:10px;color:' + color + ';font-weight:700;">Bonus ' + (i + 1) + ': ' + b + ' (' + rarity + ')</div>' +
                        '<div class="rwp-result-row">' +
                            '<span class="rwp-result-label">P25 / Median / P75</span>' +
                            '<span class="rwp-result-value" style="font-size:10px">' + fmtMoney(bd[0]) + ' / ' + fmtMoney(bd[1]) + ' / ' + fmtMoney(bd[2]) + '</span>' +
                        '</div>' +
                        '<div class="rwp-result-row">' +
                            '<span class="rwp-result-label">Sales</span>' +
                            '<span class="rwp-count">' + bd[3] + ' auctions</span>' +
                        '</div>';
                } else if (b) {
                    resultBox.innerHTML +=
                        '<div style="margin-top:6px;font-size:10px;color:#888;">No ' + rarity + ' data for bonus: ' + b + '</div>';
                }
            });

            resultDiv.appendChild(resultBox);

            // Estimated range
            const effectiveCls = cls || (weapon ? WEAPON_CLASS[weapon] : null);
            let low, mid, high;

            if (wData) {
                low = wData[0];
                mid = wData[1];
                high = wData[2];
            } else if (effectiveCls && CLASS_PRICES[effectiveCls] && CLASS_PRICES[effectiveCls][rarity]) {
                const cd = CLASS_PRICES[effectiveCls][rarity];
                low = cd[0];
                mid = cd[1];
                high = cd[2];
            }

            if (low != null) {
                const estimate = document.createElement('div');
                estimate.className = 'rwp-estimate';
                estimate.innerHTML =
                    '<div class="rwp-estimate-title">Estimated Range</div>' +
                    '<div class="rwp-estimate-range">' +
                        '<span style="color:#aaa">' + fmtMoney(low) + '</span>' +
                        ' — ' +
                        '<span style="color:' + RARITY_COLORS[rarity] + '">' + fmtMoney(mid) + '</span>' +
                        ' — ' +
                        '<span style="color:#aaa">' + fmtMoney(high) + '</span>' +
                    '</div>';
                resultDiv.appendChild(estimate);
            }
        }

        classSelect.addEventListener('change', () => {
            populateWeapons();
            updateResults();
        });
        weaponSelect.addEventListener('change', updateResults);
        qualSelect.addEventListener('change', updateResults);
        bonus1Select.addEventListener('change', updateResults);
        bonus2Select.addEventListener('change', updateResults);

        updateBonus2State();
    }

    // ─── Tab 2: Bonus Reference ──────────────────────────────

    function renderBonusRef(container) {
        const bonuses = Object.keys(BONUS_PRICES)
            .map(name => {
                const d = BONUS_PRICES[name];
                const orangeMedian = (d.Orange && d.Orange[1]) || 0;
                return { name, data: d, orangeMedian };
            })
            .sort((a, b) => b.orangeMedian - a.orangeMedian);

        let html = '<table class="rwp-table"><thead><tr>' +
            '<th>Bonus</th><th>Yellow</th><th>Orange</th><th>Red</th>' +
            '</tr></thead><tbody>';

        for (const b of bonuses) {
            const ym = (b.data.Yellow && b.data.Yellow[1]) ? fmtMoney(b.data.Yellow[1]) : 'N/A';
            const om = (b.data.Orange && b.data.Orange[1]) ? fmtMoney(b.data.Orange[1]) : 'N/A';
            const rm = (b.data.Red && b.data.Red[1]) ? fmtMoney(b.data.Red[1]) : 'N/A';

            html += '<tr>' +
                '<td style="color:#ddd;font-weight:700">' + b.name + '</td>' +
                '<td style="color:' + RARITY_COLORS.Yellow + '">' + ym + '</td>' +
                '<td style="color:' + RARITY_COLORS.Orange + '">' + om + '</td>' +
                '<td style="color:' + RARITY_COLORS.Red + '">' + rm + '</td>' +
                '</tr>';
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ─── Tab 3: Weapon Reference ─────────────────────────────

    function renderWeaponRef(container) {
        const weapons = Object.keys(WEAPON_PRICES)
            .filter(name => {
                const d = WEAPON_PRICES[name];
                return d.Orange && d.Orange[1];
            })
            .map(name => {
                const d = WEAPON_PRICES[name];
                const orangeMedian = d.Orange[1];
                return { name, data: d, cls: WEAPON_CLASS[name] || '?', orangeMedian };
            })
            .sort((a, b) => b.orangeMedian - a.orangeMedian);

        let html = '<table class="rwp-table"><thead><tr>' +
            '<th>Weapon</th><th>Class</th><th>Yellow</th><th>Orange</th><th>Red</th>' +
            '</tr></thead><tbody>';

        for (const w of weapons) {
            const ym = (w.data.Yellow && w.data.Yellow[1]) ? fmtMoney(w.data.Yellow[1]) : 'N/A';
            const om = fmtMoney(w.data.Orange[1]);
            const rm = (w.data.Red && w.data.Red[1]) ? fmtMoney(w.data.Red[1]) : 'N/A';
            const shortCls = w.cls.replace('Pistol / SMG', 'P/SMG').replace('Shotgun / Rifle', 'S/R');

            html += '<tr>' +
                '<td style="color:#ddd;font-weight:700;white-space:nowrap">' + w.name + '</td>' +
                '<td style="color:#888;font-size:9px">' + shortCls + '</td>' +
                '<td style="color:' + RARITY_COLORS.Yellow + '">' + ym + '</td>' +
                '<td style="color:' + RARITY_COLORS.Orange + '">' + om + '</td>' +
                '<td style="color:' + RARITY_COLORS.Red + '">' + rm + '</td>' +
                '</tr>';
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ─── Tab 1 (Armour): Calculator ─────────────────────────

    function renderArmourCalculator(container) {
        // Set select
        var setLabel = document.createElement('span');
        setLabel.className = 'rwp-label';
        setLabel.textContent = 'Armour Set';
        container.appendChild(setLabel);

        var setSelect = document.createElement('select');
        setSelect.className = 'rwp-select';
        setSelect.innerHTML = '<option value="">All Sets</option>' +
            ARMOUR_SETS.map(function(s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');
        container.appendChild(setSelect);

        // Armour piece select
        var pieceLabel = document.createElement('span');
        pieceLabel.className = 'rwp-label';
        pieceLabel.textContent = 'Armour Piece';
        container.appendChild(pieceLabel);

        var pieceSelect = document.createElement('select');
        pieceSelect.className = 'rwp-select';
        container.appendChild(pieceSelect);

        function populatePieces() {
            var set = setSelect.value;
            var pieces = getArmoursBySet(set || null);
            pieceSelect.innerHTML = '<option value="">-- Select Armour --</option>' +
                pieces.map(function(a) { return '<option value="' + a.replace(/"/g, '&quot;') + '">' + a + '</option>'; }).join('');
        }
        populatePieces();

        // Quality select
        var qualLabel = document.createElement('span');
        qualLabel.className = 'rwp-label';
        qualLabel.textContent = 'Quality';
        container.appendChild(qualLabel);

        var qualSelect = document.createElement('select');
        qualSelect.className = 'rwp-select';
        RARITIES.forEach(function(r) {
            var opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            opt.style.color = RARITY_COLORS[r];
            qualSelect.appendChild(opt);
        });
        qualSelect.value = 'Orange';
        container.appendChild(qualSelect);

        // Bonus 1
        var bonus1Label = document.createElement('span');
        bonus1Label.className = 'rwp-label';
        bonus1Label.textContent = 'Bonus 1';
        container.appendChild(bonus1Label);

        var bonus1Select = document.createElement('select');
        bonus1Select.className = 'rwp-select';
        var aBonusNames = getArmourBonusNames();
        bonus1Select.innerHTML = '<option value="">None</option>' +
            aBonusNames.map(function(b) { return '<option value="' + b + '">' + b + '</option>'; }).join('');
        container.appendChild(bonus1Select);

        // Bonus 2
        var bonus2Label = document.createElement('span');
        bonus2Label.className = 'rwp-label';
        bonus2Label.textContent = 'Bonus 2';
        container.appendChild(bonus2Label);

        var bonus2Select = document.createElement('select');
        bonus2Select.className = 'rwp-select';
        bonus2Select.innerHTML = '<option value="">None</option>' +
            aBonusNames.map(function(b) { return '<option value="' + b + '">' + b + '</option>'; }).join('');
        container.appendChild(bonus2Select);

        // Result area
        var resultDiv = document.createElement('div');
        resultDiv.id = 'rwp-result-area';
        container.appendChild(resultDiv);

        function updateBonus2State() {
            if (qualSelect.value === 'Yellow') {
                bonus2Select.value = '';
                bonus2Select.disabled = true;
                bonus2Select.style.opacity = '0.4';
            } else {
                bonus2Select.disabled = false;
                bonus2Select.style.opacity = '1';
            }
        }

        function updateResults() {
            updateBonus2State();
            var piece  = pieceSelect.value;
            var rarity = qualSelect.value;
            var bonus1 = bonus1Select.value;
            var bonus2 = bonus2Select.value;
            var set    = setSelect.value || (piece ? ARMOUR_SET[piece] : null);

            resultDiv.innerHTML = '';

            if (!rarity) return;

            var resultBox = document.createElement('div');
            resultBox.className = 'rwp-result';

            // Set baseline
            if (set && ARMOUR_SET_PRICES[set] && ARMOUR_SET_PRICES[set][rarity]) {
                var sd = ARMOUR_SET_PRICES[set][rarity];
                resultBox.innerHTML +=
                    '<div class="rwp-result-row">' +
                        '<span class="rwp-result-label">' + set + ' set median</span>' +
                        '<span class="rwp-result-value" style="color:' + RARITY_COLORS[rarity] + '">' + fmtMoney(sd[1]) + '</span>' +
                    '</div>';
            }

            // Piece specific
            var pData = null;
            if (piece && ARMOUR_PRICES[piece] && ARMOUR_PRICES[piece][rarity]) {
                pData = ARMOUR_PRICES[piece][rarity];
                resultBox.innerHTML +=
                    '<div style="margin-top:6px;font-size:10px;color:' + color + ';font-weight:700;">' + piece + ' (' + rarity + ')</div>' +
                    '<div class="rwp-result-row">' +
                        '<span class="rwp-result-label">P25 (Low)</span>' +
                        '<span class="rwp-result-value">' + fmtMoney(pData[0]) + '</span>' +
                    '</div>' +
                    '<div class="rwp-result-row">' +
                        '<span class="rwp-result-label">Median</span>' +
                        '<span class="rwp-result-value" style="color:' + RARITY_COLORS[rarity] + '">' + fmtMoney(pData[1]) + '</span>' +
                    '</div>' +
                    '<div class="rwp-result-row">' +
                        '<span class="rwp-result-label">P75 (High)</span>' +
                        '<span class="rwp-result-value">' + fmtMoney(pData[2]) + '</span>' +
                    '</div>' +
                    '<div class="rwp-result-row">' +
                        '<span class="rwp-result-label">Sales</span>' +
                        '<span class="rwp-count">' + pData[3] + ' auctions</span>' +
                    '</div>';
            } else if (piece) {
                resultBox.innerHTML +=
                    '<div style="margin-top:6px;font-size:10px;color:#888;">No ' + rarity + ' data for ' + piece + ' \u2014 using set data</div>';
            }

            // Bonus data
            [bonus1, bonus2].forEach(function(b, i) {
                if (!b) return;
                if (ARMOUR_BONUS_PRICES[b] && ARMOUR_BONUS_PRICES[b][rarity]) {
                    var bd = ARMOUR_BONUS_PRICES[b][rarity];
                    resultBox.innerHTML +=
                        '<div style="margin-top:6px;font-size:10px;color:' + color + ';font-weight:700;">Bonus ' + (i + 1) + ': ' + b + ' (' + rarity + ')</div>' +
                        '<div class="rwp-result-row">' +
                            '<span class="rwp-result-label">P25 / Median / P75</span>' +
                            '<span class="rwp-result-value" style="font-size:10px">' + fmtMoney(bd[0]) + ' / ' + fmtMoney(bd[1]) + ' / ' + fmtMoney(bd[2]) + '</span>' +
                        '</div>' +
                        '<div class="rwp-result-row">' +
                            '<span class="rwp-result-label">Sales</span>' +
                            '<span class="rwp-count">' + bd[3] + ' auctions</span>' +
                        '</div>';
                } else if (b) {
                    resultBox.innerHTML +=
                        '<div style="margin-top:6px;font-size:10px;color:#888;">No ' + rarity + ' data for bonus: ' + b + '</div>';
                }
            });

            resultDiv.appendChild(resultBox);

            // Estimated range
            var effectiveSet = set || (piece ? ARMOUR_SET[piece] : null);
            var low, mid, high;

            if (pData) {
                low = pData[0];
                mid = pData[1];
                high = pData[2];
            } else if (effectiveSet && ARMOUR_SET_PRICES[effectiveSet] && ARMOUR_SET_PRICES[effectiveSet][rarity]) {
                var cd = ARMOUR_SET_PRICES[effectiveSet][rarity];
                low = cd[0];
                mid = cd[1];
                high = cd[2];
            }

            if (low != null) {
                var estimate = document.createElement('div');
                estimate.className = 'rwp-estimate';
                estimate.innerHTML =
                    '<div class="rwp-estimate-title">Estimated Range</div>' +
                    '<div class="rwp-estimate-range">' +
                        '<span style="color:#aaa">' + fmtMoney(low) + '</span>' +
                        ' \u2014 ' +
                        '<span style="color:' + RARITY_COLORS[rarity] + '">' + fmtMoney(mid) + '</span>' +
                        ' \u2014 ' +
                        '<span style="color:#aaa">' + fmtMoney(high) + '</span>' +
                    '</div>';
                resultDiv.appendChild(estimate);
            }
        }

        setSelect.addEventListener('change', function() {
            populatePieces();
            updateResults();
        });
        pieceSelect.addEventListener('change', updateResults);
        qualSelect.addEventListener('change', updateResults);
        bonus1Select.addEventListener('change', updateResults);
        bonus2Select.addEventListener('change', updateResults);

        updateBonus2State();
    }

    // ─── Tab 2 (Armour): Bonus Reference ─────────────────────

    function renderArmourBonusRef(container) {
        var bonuses = Object.keys(ARMOUR_BONUS_PRICES)
            .map(function(name) {
                var d = ARMOUR_BONUS_PRICES[name];
                var orangeMedian = (d.Orange && d.Orange[1]) || 0;
                var yellowMedian = (d.Yellow && d.Yellow[1]) || 0;
                return { name: name, data: d, sortVal: orangeMedian || yellowMedian };
            })
            .sort(function(a, b) { return b.sortVal - a.sortVal; });

        var html = '<table class="rwp-table"><thead><tr>' +
            '<th>Bonus</th><th>Yellow</th><th>Orange</th><th>Red</th>' +
            '</tr></thead><tbody>';

        for (var i = 0; i < bonuses.length; i++) {
            var b = bonuses[i];
            var ym = (b.data.Yellow && b.data.Yellow[1]) ? fmtMoney(b.data.Yellow[1]) : 'N/A';
            var om = (b.data.Orange && b.data.Orange[1]) ? fmtMoney(b.data.Orange[1]) : 'N/A';
            var rm = (b.data.Red && b.data.Red[1]) ? fmtMoney(b.data.Red[1]) : 'N/A';

            html += '<tr>' +
                '<td style="color:#ddd;font-weight:700">' + b.name + '</td>' +
                '<td style="color:' + RARITY_COLORS.Yellow + '">' + ym + '</td>' +
                '<td style="color:' + RARITY_COLORS.Orange + '">' + om + '</td>' +
                '<td style="color:' + RARITY_COLORS.Red + '">' + rm + '</td>' +
                '</tr>';
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ─── Tab 3 (Armour): Armour Reference ─────────────────────

    function renderArmourRef(container) {
        var armours = Object.keys(ARMOUR_PRICES)
            .map(function(name) {
                var d = ARMOUR_PRICES[name];
                var orangeMedian = (d.Orange && d.Orange[1]) || 0;
                var yellowMedian = (d.Yellow && d.Yellow[1]) || 0;
                var redMedian = (d.Red && d.Red[1]) || 0;
                return { name: name, data: d, set: ARMOUR_SET[name] || '?', sortVal: orangeMedian || redMedian || yellowMedian };
            })
            .sort(function(a, b) { return b.sortVal - a.sortVal; });

        var html = '<table class="rwp-table"><thead><tr>' +
            '<th>Armour</th><th>Set</th><th>Yellow</th><th>Orange</th><th>Red</th>' +
            '</tr></thead><tbody>';

        for (var i = 0; i < armours.length; i++) {
            var a = armours[i];
            var ym = (a.data.Yellow && a.data.Yellow[1]) ? fmtMoney(a.data.Yellow[1]) : 'N/A';
            var om = (a.data.Orange && a.data.Orange[1]) ? fmtMoney(a.data.Orange[1]) : 'N/A';
            var rm = (a.data.Red && a.data.Red[1]) ? fmtMoney(a.data.Red[1]) : 'N/A';
            var shortSet = ARMOUR_SET_SHORT[a.set] || a.set;

            html += '<tr>' +
                '<td style="color:#ddd;font-weight:700;white-space:nowrap">' + a.name + '</td>' +
                '<td style="color:#888;font-size:9px">' + shortSet + '</td>' +
                '<td style="color:' + RARITY_COLORS.Yellow + '">' + ym + '</td>' +
                '<td style="color:' + RARITY_COLORS.Orange + '">' + om + '</td>' +
                '<td style="color:' + RARITY_COLORS.Red + '">' + rm + '</td>' +
                '</tr>';
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ─── Init ────────────────────────────────────────────────

    function init() {
        if (!panelClosed) {
            createPanel();
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
    }
})();
