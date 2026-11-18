const test = require('node:test');
const assert = require('node:assert');
const { valeur, cellule, tableau, aJeter } = require('./sauvegarde.js');

test('valeurs Firestore lues', () => {
  assert.strictEqual(valeur({ stringValue: 'GS-487-PR' }), 'GS-487-PR');
  assert.strictEqual(valeur({ integerValue: '42' }), 42);
  assert.strictEqual(valeur({ doubleValue: 37.5 }), 37.5);
  assert.strictEqual(valeur({ booleanValue: false }), false);
  assert.strictEqual(valeur({ nullValue: null }), null);
  assert.deepStrictEqual(valeur({ arrayValue: { values: [{ stringValue: 'a' }, { integerValue: '2' }] } }), ['a', 2]);
  assert.deepStrictEqual(valeur({ arrayValue: {} }), []);
  assert.deepStrictEqual(valeur({ mapValue: { fields: { texte: { stringValue: 'ok' } } } }), { texte: 'ok' });
});

test('cellules : objets en JSON, photos et formules neutralisées', () => {
  assert.strictEqual(cellule(null), '');
  assert.strictEqual(cellule({ a: 1 }), '{"a":1}');
  assert.strictEqual(cellule('x'.repeat(5000)), '(trop long : voir le fichier .json)');
  assert.strictEqual(cellule('=IMPORTXML("http://x")'), '\'=IMPORTXML("http://x")');
  assert.strictEqual(cellule(42), 42);
});

test('tableau : id en 1re colonne, plaque et service ensuite, colonnes réunies', () => {
  const docs = [
    { name: 'projects/p/databases/(default)/documents/demandes/a1', fields: { zeta: { stringValue: 'z' }, plaque: { stringValue: 'AB-123-CD' }, service: { stringValue: 'lavage' } } },
    { name: 'projects/p/databases/(default)/documents/demandes/b2', fields: { plaque: { stringValue: 'EF-456-GH' }, alpha: { integerValue: '3' } } },
  ];
  assert.deepStrictEqual(tableau(docs), [
    ['id', 'plaque', 'service', 'alpha', 'zeta'],
    ['a1', 'AB-123-CD', 'lavage', '', 'z'],
    ['b2', 'EF-456-GH', '', 3, ''],
  ]);
  assert.deepStrictEqual(tableau([]), [['id']]);
});

test('ne garde que les 12 dernières semaines (Sheet + json du même jour ensemble)', () => {
  const noms = [];
  for (let i = 1; i <= 14; i++) { const d = '2026-' + String(Math.ceil(i / 4) + 8).padStart(2, '0') + '-' + String(i).padStart(2, '0'); noms.push('Sauvegarde ' + d, 'Sauvegarde ' + d + '.json'); }
  noms.push('autre fichier');
  const jetes = aJeter(noms, 12);
  assert.deepStrictEqual(jetes, ['Sauvegarde 2026-09-01', 'Sauvegarde 2026-09-01.json', 'Sauvegarde 2026-09-02', 'Sauvegarde 2026-09-02.json']);
});
