// Starting rows (taken from your sheet). Used only on first run.
const crypto = require('crypto');
const uid = () => crypto.randomBytes(5).toString('hex');
const S = (name, amount, extra={}) => ({id:uid(), name, amount, note:'', flag:false, source:'sample', createdBy:'sheet', updatedBy:'sheet', updatedAt:null, ...extra});
const M = (name, amount, extra={}) => S(name, amount, {source:'manual', ...extra});
module.exports = () => ({
  payout:[
    S('DataApps Technology Pvt Ltd',15203),S('Kio It Solutions pvt ltd',9001903),S('GOPAL LAB CON (OPC) PRIVATE LIMITED',19577980),
    S('JOY OF LIFE MARKETING PRIVATE LIMITED',9744229),S('NATURE FVD FARMS MARKETING PRIVATE LIMITED',6780049),S('MSVS VENTURES PRIVATE LIMITED',4202710),
    S('MERCALIX FINTECH PRIVATE LIMITED',72943132),S('BHAVI LAX TECHNOLOGIES & UTILITY SOLUTIONS PRIVATE LIMITED',25413833),S('NIXASOFT FINTECH PVT LTD',23820),
    S('sm traders',2801215),S('TTGPL',2324633),S('GOOM 143 SOLUTIONS PRIVATE LIMITED',21600000),S('DIGIPE INDIA SOLUTIONS PRIVATE LIMITED',1313834),
    S('DIPAY SOLUTIONS INDIA PVT LTD',287440),S('WTRX01034421687-TRISHA',61125),S('KADU CAREER INTEGRITY (OPC) PRIVATE LIMITED',12961593),
    S('DOTUNX SOLUTIONS PRIVATE LIMITED',895086),S('V2C FINTECH PVT LTD',2998709),S('NTPAYMORE TECHNOLOGIES PRIVATE LIMITED',2605463),
    S('UTSAV PAYTECH PVT LTD',379376),S('AMBELTRADING PRIVATE LIMITED',0),S('ishmart technoglobal services private limited',20311),
    S('IPAYMNT TECH PRIVATE LIMITED',1020),S('RZPAY TECH PRIVATE LIMITED',6638),S('SAMANTRA FINANCIAL SERVICES PRIVATE LIMITED',511205),
    S('SRPAY TECHNOLOGY PVT LTD',11749),S('Transfer Saathi',2378),S('Star Technologies',297472),S('PAYFAZZ LLP',932),
    S('Trexo Commission',0),S('intra Commission',0),S('INTRAFINX TECHNOLOGY PRIVATE LIMITED [WTRX01053504691]',1561209)],
  payin:[S('MANOTESH MEDIA SOLUTIONS PRIVATE LIMITED (payin)',0),S('THE SO SOLUTIONS PRIVATE LIMITED (payin)',1304558),
    S('TRISHA FASHION (PAYIN [WTRX01094298209])',651582),S('Truefit Enterprise (payin)',502)],
  other:[M('SHUBH',1700000),M('Vishal',0),M('Mpurse',0),M('Sai Siddhi',300000),M('intrafinix need to pay',0)],
  banks:[M('BHARAT WEZBO',3112238),M('BHARAT TREXO',36628205),M('KVB TREXO',11489),M('AU-TREXO',177068),M('AU-WEZBO-700',82646),
    M('AU-WEZBO-408',116319),M('CITY UNION-WEZBO',3086919),M('CITY UNION-TREXO',341),M('CITY UNION-ECHOZIA',70),M('CITY UNION-kanika',59),
    M('CITY UNION-kanika',188),M('SBI',6881),M('SBM-WEZBO',1000000),M('Sai Sidhhi',0),M('SBM-TREXO',1000000),M('HDFC-TREXO',2563251),M('SUMOL',0)],
  uses:[M('chairman sir',8100000),M('JSK fashion',2500000,{flag:true}),M('CASH @ Office',2693200),M('INTRAFINIX',0),M('intrafinix cash',0),
    M('Raja',0),M('INTRAFINIX-payin',0),M('intrafinix CUB a/c [14-09-2026]',0),M('intrafinix other account',0),M('Dubai Office',0),
    M('Utsav Cr',1500000),M('Digipe',3000000),M('SRPAY',3000),M('Vishal Sir',0),M('SATISH SIR',2050000),
    M('NTPAYMORE TECHNOLOGIES PRIVATE LIMITED',0),M('ITRANFINX LOAN',34000000),M('GOOM 143 SOLUTIONS PRIVATE LIMITED',0),
    M('MPURSE',10000000,{flag:true}),M('credit given to MERCALIX',14850000),M('Mercalix (Cash)',3750000),M('NEXA',950000),
    M('Vipul Sir',80000000),M('TTGPL',0)],
  recovery:[M('MANOTESH MEDIA SOLUTIONS PRIVATE LIMITED (payin)',0)],
  });
