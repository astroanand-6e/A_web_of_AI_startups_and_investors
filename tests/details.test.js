import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeData } from '../js/data.js';
import { investorDetailsHtml, startupDetailsHtml, tooltipHtml } from '../js/details.js';

const data = normalizeData({
    startups: [
        { name: 'Acme <AI>', founded: '2020-03', comment: 'Builds "safe" models & tools' },
        { name: 'Beta', founded: '2021-01' },
        { name: 'Gamma', founded: '2024-06' },
    ],
    investments: [
        { investor: 'Fund & Co', startup: 'Acme <AI>', date: '2020-05' },
        { investor: 'Fund & Co', startup: 'Acme <AI>', date: '2022-02' },
        { investor: 'Fund & Co', startup: 'Beta', date: '2023-07' },
        { investor: 'Fund & Co', startup: 'Beta', date: '2024-01' },
        { investor: 'Fund & Co', startup: 'Beta', date: '2024-03' },
        { investor: 'Solo', startup: 'Acme <AI>', date: '2021-08' },
    ],
});
const startup = (name) => data.startups.find((record) => record.name === name);
const investor = (name) => data.investors.find((record) => record.name === name);

test('startup details escape names and show the founding and latest round', () => {
    const html = startupDetailsHtml(startup('Acme <AI>'), data);
    assert.ok(!html.includes('Acme <AI>'));
    assert.ok(html.includes('<h4>Acme &lt;AI&gt;</h4>'));
    assert.ok(html.includes('Builds &quot;safe&quot; models &amp; tools'));
    assert.ok(html.includes('<dt>Founded</dt><dd>Mar 2020</dd>'));
    assert.ok(html.includes('<dt>Investors</dt><dd>2</dd>'));
    assert.ok(html.includes('<dt>Latest Investment</dt><dd>Feb 2022</dd>'));
    assert.ok(html.includes('<li>Fund &amp; Co</li><li>Solo</li>'));
});

test('a startup without rounds says so and skips the investor list', () => {
    const html = startupDetailsHtml(startup('Gamma'), data);
    assert.ok(html.includes('<dd>None recorded</dd>'));
    assert.ok(!html.includes('Key Investors'));
    assert.ok(!html.includes('node-about'), 'no empty description');
});

test('investor activity lists the three most recent years, newest first', () => {
    const html = investorDetailsHtml(investor('Fund & Co'), data);
    assert.ok(html.includes('<dt>Investments</dt><dd>2 startups</dd>'));
    assert.ok(html.includes('<dt>Total Rounds</dt><dd>5</dd>'));
    assert.ok(html.includes('<ul class="node-list"><li>2024: 2 rounds</li><li>2023: 1 round</li><li>2022: 1 round</li></ul>'));
    assert.ok(!html.includes('2020:'));
});

test('long portfolio lists are truncated with a count', () => {
    const names = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
    const big = normalizeData({
        startups: names.map((name) => ({ name, founded: '2020-01' })),
        investments: names.map((name) => ({ investor: 'Big Fund', startup: name, date: '2021-01' })),
    });
    const html = investorDetailsHtml(big.investors[0], big);
    assert.ok(html.includes('<li>S5</li>'));
    assert.ok(!html.includes('<li>S6</li>'));
    assert.ok(html.includes('<li class="more">+ 2 more...</li>'));
});

test('tooltips escape the name and describe the node', () => {
    assert.equal(tooltipHtml(startup('Acme <AI>')), '<strong>Acme &lt;AI&gt;</strong><span>Founded Mar 2020</span>');
    assert.equal(tooltipHtml(investor('Solo')), '<strong>Solo</strong><span>Investor · 1 startup</span>');
});
