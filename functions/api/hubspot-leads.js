// GSI Tracker: READ-ONLY HubSpot lead pull.
// Cloudflare Pages Function — the HubSpot token lives server-side only and
// nothing is ever written back to HubSpot. Callers must hold a valid Supabase
// session (any signed-in tracker user).
//
// PULL RULE (built-in, per Kailash 2026-08-05) — a lead is pulled when ANY of:
//   1. its company matches the GSI/SI target list below (or extras from the UI)
//   2. its HubSpot owner is one of the GSI owner emails below
//   3. "GSI" appears in its searchable text or any source-detail property
//
// POST { extraCompanies?: string[], from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }
// -> { leads: [{ id, name, email, company, source, created, status,
//                lastActivity, lifecycle, owner, via: [...] }] }

const SUPABASE_URL = 'https://xyefbslbihjdczlzjatu.supabase.co'

const DEFAULT_COMPANIES = [
  'Accenture', 'Hitachi', 'Birlasoft', 'Grid Dynamics', 'Denave', 'Accion Labs', 'Trace3',
  'Genpact', 'Cyient', 'Happiest Minds', 'Sonata Software', 'Data#3', 'Telstra Purple',
  'Fujitsu', 'NRI', 'Nomura Research Institute', 'NEC Corporation', 'SCSK',
  'ITOCHU Techno-Solutions', 'CTC', 'TIS Inc', 'NS Solutions', 'Datacom', 'Spark New Zealand',
  'NCS Group', 'Singtel', 'ST Engineering', 'Azentio Software', 'Metrodata Electronics',
  'FPT Software', 'Viettel Solutions', 'Attura', 'Kinetic IT', 'Mantel Group', 'Brennan IT',
  'ABeam Consulting', 'Fusion5', 'Crimson Logic', 'Percept Solutions', 'IT Can Pte', 'Synapxe',
  'Optimum Solutions', 'Multipolar Technology', 'Lintasarta', 'Mitra Integrasi Informatika',
  'Sigma Cipta Caraka', 'CMC Technology', 'TMA Solutions', 'KMS Technology', 'Rikkeisoft',
  'NashTech', 'Sotatek', 'PSL', 'TCS', 'Infosys', 'Virtusa', 'Wipro', 'CTS', 'NTT Data', 'CGI',
  'DXC', 'Atos', 'EPAM', 'HCL', 'UST', 'Tech Mahindra', 'LTI Mindtree', 'Avanade', 'Capgemini',
  'Impetus', 'LTI', 'KPMG', 'Deloitte', 'BCG', 'Bain', 'EXL', 'EY', 'McKinsey', 'PwC',
  'Publicis Sapient', 'Oliver Wyman', 'Kearney', 'L.E.K. Consulting', 'Roland Berger',
  'OC&C Strategy Consultants', 'AlixPartners', 'West Monroe', 'Valtech', 'Credera',
  'Thoughtworks', 'EPAM Systems', 'Perficient', 'Protiviti', 'Simon-Kucher', 'BearingPoint',
  'PA Consulting', 'Arthur D. Little', 'Capco', 'Booz Allen Hamilton', 'SoftwareONE', 'Optiv',
  'Iron Bow Technologies', 'Red River', 'General Datatech (GDT)', 'AT&T Enterprise Services',
  'Verizon Enterprise Solutions', 'T-Mobile for Business (IT)', 'Comcast Business IT',
  'Dell Technologies Services', 'HPE Pointnext Services', 'Cisco Customer Experience',
  'Oracle Consulting', 'Microsoft Industry Solutions', 'SAP Services and Support',
  'Salesforce Professional Svcs', 'Workday Professional Svcs', 'ServiceNow Expert Programs',
  'PricewaterhouseCoopers (PwC)', 'Ernst & Young (EY)', 'BDO Digital',
  'Grant Thornton IT Advisory', 'RSM US Technology', 'Baker Tilly Digital',
  'FTI Consulting (Tech)', 'AlixPartners (Digital)', 'WTW (Tech Consulting)',
  'Kearney (Digital)', 'Oliver Wyman (Digital)', 'Roland Berger (IT)', 'LEK Consulting (Tech)',
  'OC&C Strategy', 'BCG X', 'Bain Digital', 'ZS Associates (Tech)', 'Dalberg (Tech advisory)',
  'Aon (IT/Cyber)', 'Optum (Healthcare IT)', 'Epic Systems (Integration)',
  'Cerner (Oracle Health)', 'eClinicalWorks', 'Allscripts (Veradigm)', 'Meditech Services',
  'Conduent', 'Maximus', 'Amdocs', 'Netcracker Technology', 'FIS Global Services',
  'Fiserv IT Solutions', 'SS&C Technologies', 'Broadridge IT Services',
  'Jack Henry IT Services', 'NCR Voyix IT Services', 'Diebold Nixdorf IT',
  'Sabre Corporation (IT)', 'Black Knight (IT Services)', 'Core BTS', 'Long View Systems',
  'Sycomp', 'UNICOM Engineering', 'GTT Communications', 'TeamLogic IT', 'RapidScale',
  'RJ Young', 'ACP CreativIT', 'Apps Associates', 'Alchemy Technology Group', 'MDSi',
  'Quantiphi', 'Evergreen Services Group', 'Applied Innovation', 'Milner, Inc.', 'Blue Tech',
  'Bluum', 'iT1 Source', 'Ntiva', 'The Redesign Group', 'Centre Technologies',
  'Managed Solution', 'Corsica Technologies', 'Summit 7 Systems', 'ThunderCat Technology',
  'Blue Mantis', 'AEC Group', 'Arctiq', 'Verinext', 'Driven Technologies',
  'DoIT International', 'Align', 'In-Telecom', 'Paragon Micro', 'Marlabs', 'Jitterbit',
  'ATS Automation', 'JR Automation', 'MAVERICK Technologies', 'Premier Automation', 'Intech',
  'Apex Systems', 'Randstad Technologies', 'Kforce', 'Ciber', 'BAE Systems Intel & Sec',
  'L3Harris Technologies IT', 'Sirius Computer Solutions', 'Tata Consultancy Services',
  'LTIMindtree', 'Coforge', 'Mphasis', 'Redington', 'Hexaware Technologies',
  'Zensar Technologies', 'Microland', 'Mastek', 'Virtusa (India Ops)', 'Tata Elxsi',
  'Tata Technologies', 'L&T Technology Services', 'Quest Global', 'Firstsource Solutions',
  'KPIT Technologies', 'WNS Global Services', 'EXL Service', 'Hinduja Global Solutions',
  'eClerx', 'Datamatics', 'Intellect Design Arena', 'ITC Infotech', 'Tata Communications (IT)',
  'Reliance Jio (Enterprise)', 'Bharti Airtel (Enterprise)', 'Sify Technologies',
  'Ramco Systems', 'NeST Digital', 'Quess Corp (Tech)', 'Infogain', 'GlobalLogic',
  'UST Global', 'Brillio', 'Cigniti Technologies', 'Accolite Digital', 'Xoriant',
  'YASH Technologies', 'Mastech Digital', 'Collabera', 'Kellton Tech', 'GAVS Technologies',
  'ValueLabs', 'R Systems', 'Newgen Software (Impl.)', 'Majesco', 'Rolta', 'CMS Info Systems',
  'Vakrangee', 'AGS Transact Technologies', 'SIS Limited (Tech Div)',
  'Allied Digital Services', 'TeamLease Digital', 'Innova Solutions', 'Infinite Computer Sols',
  'Ness Digital Engineering', 'Tavant', 'Synechron', 'Nagarro', 'Icertis', 'Fractal Analytics',
  'Mu Sigma', 'LatentView Analytics', 'Tredence', 'Cartesian Consulting', 'Tiger Analytics',
  'Dicker Data', 'WiseTech Global (Services)', 'Codan (IT Services)', 'Technology One',
  'Iress', 'Tyro Payments (IT)', 'NEXTDC (Cloud Integration)', 'CyberCX', 'Tesserent',
  'Interactive Pty Ltd', 'Macquarie Telecom Group', 'Spark New Zealand IT',
  'Chorus Limited IT', 'Optus Enterprise', 'TPG Telecom Enterprise', 'ARQ Group',
  'SMS Management', 'DWS Group', 'Ethan Group', 'MOQdigital', 'Southern Cross Comp. Sys',
  'Blue Apache', 'ITonCloud', 'Firstmac', 'Link Group IT', 'Computershare IT',
  'Altium Services', 'Xero Integration Services', 'MYOB Integration', 'Hansen Technologies',
  'Infomedia', 'Bravura Solutions', 'Integrated Research', 'Promicus', 'FNZ Group',
  'Object Consulting', 'KAZ Group', 'Volante Group', 'Commander Communications', 'Alphawest',
  'Hostworks', 'Peoplebank', 'Oakton', 'RXP Services', 'ASG Group', 'Dialog Information Tech',
  'Empired', 'UXC', 'Melbourne IT', 'Thomas Duryea', 'Readify', 'Data Action', 'NEC Australia',
  'Advent One', 'Nexon Asia Pacific', 'AC3', 'Over the Wire', 'Amcom',
  'Vocus Communications Ent', 'Superloop Enterprise', 'Macquarie Cloud Services', 'Kordia',
  'Datavail (ANZ)', 'Tquila', 'Versent', 'Innablr', 'Modis Australia', 'Ignia', 'Kloud',
  'Cevo', 'Contino', 'CMD Solutions', 'Mechanical Rock', 'Eliiza', 'Kasna', 'Cuusoo', 'Acurus',
  'Olikka', 'Vibrato', 'Fujitsu Global Services', 'NEC Enterprise Solutions',
  'SoftBank Technology', 'KDDI Evolva', 'NTT Communications', 'NTT East / West IT',
  'Toshiba Digital Solutions', 'Mitsubishi Electric IT', 'Panasonic Info Systems',
  'Canon IT Solutions', 'Ricoh IT Solutions', 'Oki Electric IT', 'Epson IT', 'Uchida Yoko',
  'Net One Systems', 'IIJ (Internet Initiative)', 'Ryoyo Electro IT', 'SK Group IT (SK C&C)',
  'Samsung SDS', 'LG CNS', 'Hyundai AutoEver', 'Posco I&C', 'Lotte Data Communication',
  'Hanwha Systems', 'Shinsegae I&C', 'Asiana IDT', 'KT DS', 'CJ OliveNetworks', 'Dongbu ICT',
  'Kolon Benit', 'Hyosung ITX', 'KCC Info & Communication', 'Daou Tech',
  'Ssangyong Info & Comm', 'NDS Corp (Nongshim)', 'LIG System', 'Taekwang Industrial IT',
  'IS Dongseo IT', 'Halla IMS', 'SeAH Networks', 'E-Land INNOSYS', 'Dongkuk Systems',
  'Samyang Data Systems', 'HiteJinro IT', 'Hansol Inticube', 'Nonghyup NDS', 'Harim I&C',
  'Amorepacific Systems', 'SPC Networks', 'Simplex', 'SIGMAXYZ', 'SRA Holdings', 'JFE Systems',
  'NSW (Nippon Systemware)', 'Ryobi Systems', 'CAC Holdings', 'ITFOR', 'Minori Solutions',
  'Argo Graphics', 'Core Corporation', 'Daiko Clearing Services', 'Densan System',
  'Fukui Computer', 'Giken Matsumura', 'I-Net', 'Ines', 'Information Development',
  'Japan Third Party', 'JBCC', 'Kanden System', 'Minato Holdings', 'Mitsubishi Research Inst.',
  'ND Software', 'NEC Networks & System', 'Nittetsu Hitachi Systems', 'Satori Electric',
  'Shinko Shoji', 'Softcreate', 'Tomen Devices', 'Toyo Business Engineering',
  'Yonden Information Sys', 'Venture Corporation', 'ASMPT Integration', 'AEM Holdings IT',
  'Grand Venture Technology', 'UMS Holdings IT', 'Aztech Global Tech', 'Nanofilm Technologies',
  'Singtel Enterprise', 'Keppel Telecoms & Trans', 'ST Engineering Digital', 'PCCW Solutions',
  'M1 Enterprise Solutions', 'CrimsonLogic', 'Certis CISCO IT', 'Nera Telecommunications',
  'Ooredoo IT Solutions', 'StarHub Enterprise', 'Maxis Business', 'Celcom Axiata Enterprise',
  'Telekom Malaysia Ent', 'Time dotCom Business', 'PLDT Enterprise', 'Globe Business IT',
  'DITO Enterprise', 'Telkom Indonesia Ent', 'Indosat Ooredoo Business', 'XL Axiata Business',
  'Smartfren Business', 'AIS Enterprise', 'True Corporation IT', 'DTAC Business',
  'Viettel Enterprise Sols', 'VNPT Solutions', 'Mobifone IT', 'Mytel IT Solutions',
  'Unitel Enterprise', 'Metfone Enterprise', 'Halotel IT', 'Lumitel IT', 'Bitel Enterprise',
  'Natcom Enterprise', 'Movitel IT', 'Telemor IT', 'Viettel Global', 'KDDI Singapore',
  'SoftBank Telecom SG', 'NTT Singapore', 'Fujitsu Asia', 'NEC Asia Pacific',
  'Toshiba Asia Pacific', 'Mitsubishi Electric Asia', 'Panasonic Asia Pacific IT',
  'Canon Singapore IT', 'Ricoh Asia Pacific IT', 'Oki Asia', 'Epson Singapore IT',
  'Huawei International (SG)', 'ZTE Corporation (ASEAN)', 'Lenovo Enterprise Sols',
  'H3C Technologies', 'Inspur Global Services', 'Ruijie Networks', 'Sangfor Technologies',
  'D-Link Enterprise Sols', 'TP-Link Business Sols', 'Zyxel Enterprise', 'Startek', 'VADS',
  'Cuscapi', 'Mesiniaga', 'Scicom', 'Dataprep', 'Prestariang', 'Heitech Padu', 'Microlink',
  'Formis', 'Symphony House', 'GHL Systems', 'Green Packet', 'Theta Edge',
  'Siemens MindSphere', 'Mobily Tech Solutions', 'Gulf Business Machines',
  'AlFuttaim Technologies', 'Alpha Data', 'Raqmiyat', 'Mannai Corporation IT',
  'Emitac Enterprise Sols', 'Omnix International', 'ITQAN', 'CNS Middle East',
  'Jeraisy Computer & Comm', 'EJADA Systems', 'AlJammaz Technologies', 'Natcom',
  'BTC Networks', 'Cazar', 'Malomatia', 'Meeza', 'EBLA Computer Consultancy', 'Gulf Computers',
  'Zak Solutions', 'ITS (Intl Turnkey Systems)', 'Al-Khaleej Computers', 'Estarta', 'PACC',
  'Bynet Data Communications', 'Matrix IT', 'Malam Team', 'One1', 'Ness Technologies',
  'Aman Group', 'Hilan', 'Taldor', 'Yael Software', 'Elbit Systems IT', 'IAI (Aerospace IT)',
  'Sopra Steria', 'Tietoevry', 'Asseco', 'ALTEN', 'Indra Sistemas', 'Orange Business Services',
  'BT Global Services', 'Vodafone Global Enterprise', 'Deutsche Telekom IT', 'Telefonica Tech',
  'Swisscom T-Systems', 'T-Systems', 'Eviden (Atos)', 'TechData (TD Synnex EU)', 'Atea',
  'Bechtle', 'Cancom', 'Econocom', 'Reply', 'Engineering Groupe', 'Lutech', 'Almaviva',
  'Devoteam', 'Inetum', 'Neurones', 'Gfi Informatique', 'Minsait', 'BAE Systems Applied Intel',
  'Capita', 'Agilisys', 'Fujitsu Services Europe', 'FDM Group', 'Endava', 'Kin + Carta',
  'BJSS', 'Version 1', 'Daisy Group', 'KCOM', 'Node4', 'Advanced Computer Software',
  'Mastek UK', 'Redcentric', 'Netcompany', 'Bouygues Telecom Ent.', 'Proximus Tech',
  'KPN IT Solutions', 'A1 Telekom IT', 'Sunrise Communications IT', 'Ericsson IT Solutions',
  'Nokia Enterprise Services', 'Siemens Advanta', 'Bosch Digital', 'Schneider Electric IT',
  'ABB IT Services', 'Thales Digital Identity', 'Leonardo IT', 'Dassault Systemes IT',
  'BAE Systems Digital', 'Airbus Cybersecurity',
]

const OWNER_EMAILS = [
  'anju@lyzr.ai',
  'praveen.sukumar@lyzr.ai',
  'praveen.s@lyzr.ai', // Praveen's actual HubSpot owner email (verified 2026-08-05)
  'bharath@lyzr.ai',
  'kaushik.venkatesan@lyzr.ai',
  'pooja@lyzr.ai',
]

const PROPS = [
  'firstname', 'lastname', 'email', 'company', 'createdate',
  'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
  'hs_latest_source', 'hs_latest_source_data_1', 'hs_latest_source_data_2',
  'hs_lead_status', 'lifecyclestage', 'notes_last_updated', 'lastmodifieddate',
  'hubspot_owner_id',
  // Lead Scoring Agent + lead source properties (per Kailash 2026-08-05)
  'lsa_lead_score', 'lsa_lead_score_category', 'lsa_lead_source',
  'lyzr_lead_score', 'lyzr_lead_score_category', 'hubspotscore',
  'lead_source', 'lead_source_category',
]

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const res = await fetch(`${env.SUPABASE_URL || SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY || '' },
  })
  if (!res.ok) return null
  const user = await res.json()
  return user?.email ? user : null
}

// Boundaries are calendar days in the VIEWER's timezone (IST unless the client
// says otherwise) — a UTC reading would drop/add a day's worth of leads.
function dateFilters(from, to, tzOffsetMinutes) {
  const off = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 330 // IST = UTC+05:30
  const f = []
  if (from) f.push({ propertyName: 'createdate', operator: 'GTE', value: Date.parse(from + 'T00:00:00Z') - off * 60000 })
  if (to) f.push({ propertyName: 'createdate', operator: 'LTE', value: Date.parse(to + 'T23:59:59.999Z') - off * 60000 })
  return f
}

async function hsSearch(token, body) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: PROPS, limit: 100, sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }], ...body }),
  })
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function collect(token, searchBody, tag, into, maxPages = 2) {
  let after
  let pages = 0
  do {
    const data = await hsSearch(token, after ? { ...searchBody, after } : searchBody)
    for (const r of data.results || []) {
      const existing = into.get(r.id)
      if (existing) {
        if (!existing.via.includes(tag)) existing.via.push(tag)
      } else {
        into.set(r.id, { raw: r, via: [tag] })
      }
    }
    after = data.paging?.next?.after
    pages++
  } while (after && pages < maxPages)
  return Boolean(after) // more results existed than the page cap allowed
}

async function fetchOwners(token) {
  const byId = {}
  const idByEmail = {}
  let error = null
  try {
    const res = await fetch('https://api.hubapi.com/crm/v3/owners?limit=500', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      for (const o of data.results || []) {
        byId[o.id] = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || o.id
        if (o.email) idByEmail[o.email.toLowerCase()] = o.id
      }
    } else {
      error = `owners lookup failed (HTTP ${res.status})`
    }
  } catch {
    error = 'owners lookup failed (network)'
  }
  return { byId, idByEmail, error }
}

export async function onRequestPost({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://lyzr.kailash-gm.com',
    'Cache-Control': 'no-store',
  }
  try {
    const user = await requireUser(request, env)
    if (!user) return new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401, headers })

    const token = env.HUBSPOT_ACCESS_TOKEN
    if (!token) return new Response(JSON.stringify({ error: 'HUBSPOT_ACCESS_TOKEN not configured on Pages project' }), { status: 503, headers })

    const body = await request.json().catch(() => ({}))
    const extra = (body.extraCompanies || []).map(c => String(c).trim()).filter(Boolean)
    const companies = [...new Set([...DEFAULT_COMPANIES, ...extra])]
    const { from, to } = body
    const dates = dateFilters(from, to, body.tzOffsetMinutes)

    const { byId: ownerNames, idByEmail, error: ownerError } = await fetchOwners(token)
    const found = new Map() // id -> { raw, via[] }

    // Every search this pull needs, as a flat resumable list. No rule has a
    // page cap any more: when this invocation runs out of subrequest budget it
    // returns a cursor and the browser calls straight back to continue, so the
    // pull is limited only by how many leads actually match.
    const ownerIds = OWNER_EMAILS.map(e => idByEmail[e]).filter(Boolean)
    const warnings = []
    if (ownerError) {
      // Without the owners list we cannot resolve owner emails to ids, so the
      // "owned by a GSI owner" rule cannot run and owner names stay blank.
      warnings.push(`Rule 2 (leads owned by the GSI owners) was skipped: ${ownerError}. Grant the HubSpot private app the crm.objects.owners.read scope.`)
    } else if (!ownerIds.length) {
      warnings.push('None of the 5 GSI owner emails matched a HubSpot owner, so rule 2 matched nothing.')
    }
    const tasks = []
    for (let i = 0; i < companies.length; i += 5) {
      const batch = companies.slice(i, i + 5) // HubSpot allows 5 filterGroups per search
      tasks.push({ tag: 'company', body: {
        filterGroups: batch.map(name => ({
          filters: [{ propertyName: 'company', operator: 'CONTAINS_TOKEN', value: name }, ...dates],
        })),
      } })
    }
    if (ownerIds.length) {
      tasks.push({ tag: 'owner', body: {
        filterGroups: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'IN', values: ownerIds }, ...dates] }],
      } })
    }
    tasks.push({ tag: 'gsi', body: { query: 'GSI', filterGroups: dates.length ? [{ filters: dates }] : undefined } })
    for (const prop of [
      'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
      'hs_latest_source_data_1', 'hs_latest_source_data_2',
      // Paid-ads leads carry "LinkedIn Ads - GSI & SI" here, not in the
      // analytics source fields — without these two they were never pulled.
      'lsa_lead_source', 'lead_source',
    ]) {
      tasks.push({ tag: 'gsi', body: {
        filterGroups: [{ filters: [{ propertyName: prop, operator: 'CONTAINS_TOKEN', value: 'GSI' }, ...dates] }],
      } })
    }

    // Cloudflare allows 50 subrequests per invocation; fetchOwners used one.
    const BUDGET = 44
    let used = 0
    const cursor = body.cursor || {}
    let taskIndex = Number.isInteger(cursor.taskIndex) ? cursor.taskIndex : 0
    let after = cursor.after || undefined
    let nextCursor = null

    while (taskIndex < tasks.length) {
      if (used >= BUDGET) { nextCursor = { taskIndex, after: after ?? null }; break }
      const task = tasks[taskIndex]
      const data = await hsSearch(token, after ? { ...task.body, after } : task.body)
      used++
      for (const r of data.results || []) {
        const existing = found.get(r.id)
        if (existing) {
          if (!existing.via.includes(task.tag)) existing.via.push(task.tag)
        } else {
          found.set(r.id, { raw: r, via: [task.tag] })
        }
      }
      after = data.paging?.next?.after
      if (!after) { taskIndex++; after = undefined }
    }

    const leads = [...found.values()].map(({ raw, via }) => {
      const p = raw.properties || {}
      return {
        id: raw.id,
        name: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || 'Unknown',
        email: p.email || '',
        company: p.company || '',
        source: [p.hs_analytics_source, p.hs_analytics_source_data_1].filter(Boolean).join(' · ') || '',
        created: p.createdate || '',
        status: p.hs_lead_status || '',
        lifecycle: p.lifecyclestage || '',
        lastActivity: p.notes_last_updated || p.lastmodifieddate || '',
        owner: ownerNames[p.hubspot_owner_id] || '',
        leadScore: p.lsa_lead_score || p.lyzr_lead_score || p.hubspotscore || '',
        scoreCategory: p.lsa_lead_score_category || p.lyzr_lead_score_category || '',
        leadSource: p.lead_source || p.lsa_lead_source || '',
        sourceCategory: p.lead_source_category || '',
        via,
      }
    })
    leads.sort((a, b) => (b.created || '').localeCompare(a.created || ''))
    return new Response(JSON.stringify({
      leads,
      count: leads.length,
      nextCursor,                       // non-null => call again to continue
      progress: { done: taskIndex, total: tasks.length },
      warnings,
    }), { status: 200, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err).slice(0, 300) }), { status: 502, headers })
  }
}
