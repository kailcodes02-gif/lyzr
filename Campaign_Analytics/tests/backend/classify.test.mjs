// node --test Campaign_Analytics/tests/backend/
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { toAccount, toBand, toRegion, bandsFromSeeds, norm } from '../../../functions/api/ca/_lib/classify.js'
import { DEFAULT_COMPANIES } from '../../../functions/api/_lib/target-companies.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const seed = (f) => JSON.parse(readFileSync(path.join(here, '..', '..', 'seed', f), 'utf8'))
const accounts = seed('accounts.json')
const bandTitles = seed('band_titles.json')
const regions = seed('regions.json')
const bands = bandsFromSeeds(bandTitles, accounts)

test('norm strips punctuation and case', () => {
  assert.equal(norm('  Ernst & Young, LLP. '), 'ernst and young llp')
})

test('toAccount: exact canonical and alias matches', () => {
  assert.equal(toAccount('Accenture', accounts), 'Accenture')
  assert.equal(toAccount('accenture in india', accounts), 'Accenture')
  assert.equal(toAccount('KPMG US', accounts), 'KPMG')
  assert.equal(toAccount('EY', accounts), 'EY')
})

test('toAccount: synonyms normalise to the accounts.json canonical name', () => {
  assert.equal(toAccount('TCS', accounts), 'Tata Consultancy Services')
  assert.equal(toAccount('Tata Consultancy Services Ltd', accounts), 'Tata Consultancy Services')
  assert.equal(toAccount('BCG', accounts), 'Boston Consulting Group (BCG)')
  assert.equal(toAccount('Boston Consulting Group', accounts), 'Boston Consulting Group (BCG)')
  assert.equal(toAccount('Ernst & Young', accounts), 'EY')
  assert.equal(toAccount('Ernst and Young LLP', accounts), 'EY')
  assert.equal(toAccount('PricewaterhouseCoopers', accounts), 'PwC')
  assert.equal(toAccount('PwC India', accounts), 'PwC')
  assert.equal(toAccount('HCL Technologies', accounts), 'HCLTech')
  assert.equal(toAccount('HCL', accounts), 'HCLTech')
  assert.equal(toAccount('LTI Mindtree', accounts), 'LTIMindtree')
  assert.equal(toAccount('Cognizant Technology Solutions', accounts), 'Cognizant')
  assert.equal(toAccount('CTS', accounts), 'Cognizant')
  assert.equal(toAccount('McKinsey', accounts), 'McKinsey & Company')
  assert.equal(toAccount('Bain', accounts), 'Bain & Company')
})

test('toAccount: case-insensitive contains on canonical names and the target list', () => {
  assert.equal(toAccount('Deloitte Consulting LLP', accounts), 'Deloitte')
  assert.equal(toAccount('Infosys BPM', accounts), 'Infosys')
  assert.equal(toAccount('Capgemini Invent', accounts, DEFAULT_COMPANIES), 'Capgemini')
  assert.equal(toAccount('Publicis Sapient', accounts, DEFAULT_COMPANIES), 'Publicis Sapient')
  assert.equal(toAccount('The Wipro Limited', accounts), 'Wipro')
})

test('toAccount: no match returns null and short tokens do not false-match', () => {
  assert.equal(toAccount('', accounts), null)
  assert.equal(toAccount(null, accounts), null)
  assert.equal(toAccount('Acme Widgets', accounts), null)
  assert.equal(toAccount('Beyond Ltd', accounts), null) // 'ey' must be a whole token
  assert.equal(toAccount('IT Services Co', accounts, DEFAULT_COMPANIES), null)
})

test('toBand: per-account conventions come first', () => {
  assert.equal(toBand('Partner', 'EY', bands), 'MD')
  assert.equal(toBand('Senior Manager', 'EY', bands), 'MD-1')       // EY: Senior Manager / Director = MD-1
  assert.equal(toBand('Manager', 'EY', bands), 'MD-2')
  assert.equal(toBand('Director', 'PwC', bands), 'MD-1')            // PwC: Director = MD-1
  assert.equal(toBand('Senior Manager', 'PwC', bands), 'MD-2')
  assert.equal(toBand('Managing Director and Partner', 'Boston Consulting Group (BCG)', bands), 'MD')
  assert.equal(toBand('Project Leader', 'Boston Consulting Group (BCG)', bands), 'MD-2')
  assert.equal(toBand('Engagement Manager', 'McKinsey & Company', bands), 'MD-2')
  assert.equal(toBand('Associate Partner', 'McKinsey & Company', bands), 'MD-1')
  assert.equal(toBand('Senior Vice President', 'Genpact', bands), 'MD')   // SVP abbreviation expands
  assert.equal(toBand('AVP - Digital', 'Genpact', bands), 'MD-2')
  assert.equal(toBand('Vice President', 'Cognizant', bands), 'MD-1')
  assert.equal(toBand('Senior Managing Director', 'Accenture', bands), 'MD')
  assert.equal(toBand('Associate Director', 'Accenture', bands), 'MD-1')
})

test('toBand: global LinkedIn buckets and the Director split', () => {
  assert.equal(toBand('Managing Partner', null, bands), 'MD')
  assert.equal(toBand('Principal', null, bands), 'MD-1')
  assert.equal(toBand('Senior Director', null, bands), 'MD-1')
  assert.equal(toBand('Delivery Head', null, bands), 'MD-2')
  assert.equal(toBand('Technical Manager', null, bands), 'MD-2')
  const d = toBand('Director', null, bands)
  assert.ok(d === 'MD-1' || d === 'MD-2')
  assert.equal(toBand('Director', null, bands), d) // deterministic
  assert.equal(toBand('Director', 'Acme', bands), d)
})

test('toBand: keyword rules and fallbacks', () => {
  assert.equal(toBand('SVP, Cloud', 'Acme', {}), 'MD')
  assert.equal(toBand('Global Managing Director', 'Acme', {}), 'MD')
  assert.equal(toBand('VP Engineering', 'Acme', {}), 'MD-1')
  assert.equal(toBand('Associate Partner', 'Acme', {}), 'MD-1')   // longer phrase beats 'partner'
  assert.equal(toBand('Senior Manager, Consulting', 'Acme', {}), 'MD-2')
  assert.equal(toBand('General Manager', 'Acme', {}), 'MD-2')
  assert.equal(toBand('Software Engineer', 'Acme', bands), 'Other')
  assert.equal(toBand('', 'Acme', bands), 'Unknown')
  assert.equal(toBand(null, null, bands), 'Unknown')
})

test('toRegion: names, case, codes and unknowns', () => {
  assert.equal(toRegion('India', regions), 'India')
  assert.equal(toRegion('india', regions.regions), 'India')
  assert.equal(toRegion('IN', regions), 'India')
  assert.equal(toRegion('US', regions), 'United States')
  assert.equal(toRegion('USA', regions), 'United States')
  assert.equal(toRegion('Canada', regions), 'United States')
  assert.equal(toRegion('GB', regions), 'United Kingdom')
  assert.equal(toRegion('AE', regions), 'Middle East')
  assert.equal(toRegion('SA', regions), 'Middle East')
  assert.equal(toRegion('Türkiye', regions), 'Middle East')
  assert.equal(toRegion('Germany', regions), 'Europe')
  assert.equal(toRegion('Singapore', regions), 'APAC')
  assert.equal(toRegion('Brazil', regions), 'LATAM')
  assert.equal(toRegion('Antarctica', regions), 'Other')
  assert.equal(toRegion('', regions), 'Other')
  assert.equal(toRegion('India', null), 'Other')
})

test('bandsFromSeeds builds the settings.bands shape', () => {
  assert.deepEqual(Object.keys(bands).sort(), ['accounts', 'global', 'note'])
  assert.ok(Array.isArray(bands.global.MD))
  assert.equal(bands.accounts.EY.md, 'Partner / Principal / MD')
})
