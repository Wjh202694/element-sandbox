// 无头冒烟测试：node tools/sim-test.mjs
// 直接跑模拟核心，验证基础行为，不依赖 Phaser
import { World } from '../src/sim/world.js';
import { E } from '../src/sim/elements.js';

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failed++;
}

const W = 60;
const H = 60;

function makeWorld() {
  return new World(W, H, () => {});
}

function count(world, id) {
  let n = 0;
  for (let i = 0; i < world.cells.length; i++) if (world.cells[i] === id) n++;
  return n;
}

// 1. 沙会下落
{
  const w = makeWorld();
  w.paint(30, 5, 2, E.SAND);
  const before = count(w, E.SAND);
  for (let s = 0; s < 30; s++) w.step();
  const anyLow = w.cells.some((c, i) => c === E.SAND && Math.floor(i / W) > 30);
  check('沙自由下落', before > 0 && anyLow);
}

// 2. 沙会堆积成堆（落在石头上不再穿过）
{
  const w = makeWorld();
  w.paint(30, 40, 6, E.STONE);
  w.paint(30, 5, 4, E.SAND);
  for (let s = 0; s < 60; s++) w.step();
  const resting = w.cells.some((c, i) => {
    if (c !== E.SAND) return false;
    const y = Math.floor(i / W);
    return y >= 30 && y < 40;
  });
  check('沙遇石堆积', resting);
}

// 3. 水会落到容器底部并铺开
{
  const w = makeWorld();
  w.paint(30, 5, 5, E.WATER);
  const total = count(w, E.WATER);
  for (let s = 0; s < 120; s++) w.step();
  const anyLow = w.cells.some((c, i) => c === E.WATER && Math.floor(i / W) > 50);
  check('水落到底部', total >= 60 && anyLow);
}

// 4. 火遇水 → 蒸汽 + 灭火（石碗锁水，确保火水稳定相邻）
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let x = 25; x <= 35; x++) w2.set(40 * W + x, E.STONE); // 池底
  for (let y = 37; y <= 39; y++) {
    w2.set(y * W + 25, E.STONE);
    w2.set(y * W + 35, E.STONE);
  } // 池壁
  for (let x = 26; x <= 34; x++) {
    w2.set(38 * W + x, E.WATER);
    w2.set(39 * W + x, E.WATER);
  }
  w2.paint(30, 37, 1, E.FIRE); // 火紧贴水面
  for (let s = 0; s < 40; s++) w2.step();
  check('火×水 → 触发 steam 发现', disc.includes('steam'));
  check('火被水浇灭', count(w2, E.FIRE) < 5);
}

// 5. 火烧木头
{
  const w = makeWorld();
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  w2.paint(30, 30, 5, E.WOOD);
  w2.paint(30, 27, 1, E.FIRE);
  for (let s = 0; s < 200; s++) w2.step();
  check('火×木 → 触发 wood_burn 发现', disc.includes('wood_burn'));
  check('木头被烧毁', count(w2, E.WOOD) < 30);
}

// 6. 油浮于水（先油后水注入，水面应出现油层）
{
  const w = makeWorld();
  w.paint(30, 40, 5, E.WATER);
  w.paint(30, 30, 4, E.OIL);
  for (let s = 0; s < 60; s++) w.step();
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  w2.paint(30, 40, 5, E.WATER);
  w2.paint(30, 30, 4, E.OIL);
  for (let s = 0; s < 150; s++) w2.step(); // 充分沉降，避免持续翻滚期的水压油瞬态
  check('油×水 → 触发 float 发现', disc.includes('float'));
  // 浮力不变量：水比油重，水永不压在油上（水在油上一步内必然下沉交换）。
  // 注：不能断言「最高油格严格高于最高水格」——水面静止时堆成中央鼓起的丘，
  // 油沿丘面摊到两翼，翼上的油与丘顶的水天然同一行。
  let waterOnOil = 0;
  for (let s = 0; s < 15; s++) {
    w2.step();
    waterOnOil = 0;
    for (let i = 0; i + W < w2.cells.length; i++) {
      if (w2.cells[i] === E.WATER && w2.cells[i + W] === E.OIL) waterOnOil++;
    }
    if (!waterOnOil) break;
  }
  check('油浮于水（无水压油，油水自动分层）', waterOnOil === 0 && count(w2, E.OIL) > 0);
}

// 7. 植物遇水生长（水困在石碗中稳定相邻，否则水会沿地势流走）
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let x = 24; x <= 36; x++) w2.set(35 * W + x, E.STONE); // 池底
  for (let y = 31; y <= 34; y++) {
    w2.set(y * W + 27, E.STONE);
    w2.set(y * W + 33, E.STONE);
  } // 池壁
  w2.paint(27, 30, 2, E.PLANT); // 墙顶植物，根部探入水面上方
  for (let y = 32; y <= 34; y++) {
    for (let x = 28; x <= 32; x++) w2.set(y * W + x, E.WATER);
  }
  const plantBefore = count(w2, E.PLANT);
  for (let s = 0; s < 2400; s++) w2.step();
  check('水×植物 → 触发 growth 发现', disc.includes('growth'));
  check(`植物扩张（${plantBefore} → ${count(w2, E.PLANT)}）`, count(w2, E.PLANT) > plantBefore);
}

// 8. RLE 存取往返一致
{
  const w = makeWorld();
  w.seedWorld();
  const orig = Uint8Array.from(w.cells);
  // 模拟 storage 的 RLE 编解码
  const out = [];
  let i = 0;
  while (i < w.cells.length) {
    const v = w.cells[i];
    let n = 1;
    while (n < 255 && i + n < w.cells.length && w.cells[i + n] === v) n++;
    out.push(n, v);
    i += n;
  }
  const cells = new Uint8Array(W * H);
  let p = 0;
  for (let k = 0; k < out.length; k += 2) {
    cells.fill(out[k + 1], p, p + out[k]);
    p += out[k];
  }
  let same = true;
  for (let j = 0; j < cells.length; j++) if (cells[j] !== orig[j]) { same = false; break; }
  check(`RLE 存档往返一致（压缩 ${orig.length} → ${out.length} 项）`, same);
}

// 10. 熔岩×水 → 岩化（石+蒸汽）
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  w2.paint(30, 36, 3, E.LAVA);
  w2.paint(30, 30, 2, E.WATER);
  for (let s = 0; s < 60; s++) w2.step();
  check('熔岩×水 → 触发 lava_stone 发现', disc.includes('lava_stone'));
  check('熔岩冷淬成石', count(w2, E.STONE) > 5);
  check('水汽化成蒸汽', count(w2, E.STEAM) > 0);
}

// 11. 沙×熔岩 → 玻璃
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  w2.paint(30, 36, 3, E.LAVA);
  w2.paint(30, 30, 3, E.SAND);
  for (let s = 0; s < 150; s++) w2.step();
  check('沙×熔岩 → 触发 glass 发现', disc.includes('glass'));
  check('沙被烧成玻璃', count(w2, E.GLASS) > 0);
}

// 12. 火×火药 → 爆炸连锁（火药堆放在石台上，火点堆顶）
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let x = 24; x <= 36; x++) w2.set(35 * W + x, E.STONE); // 石台
  w2.paint(30, 32, 4, E.GUNPOWDER);
  const powderTotal = count(w2, E.GUNPOWDER);
  w2.paint(30, 28, 1, E.FIRE); // 紧贴堆顶
  for (let s = 0; s < 30; s++) w2.step();
  check('火×火药 → 触发 boom 发现', disc.includes('boom'));
  check(`火药殉爆殆尽（剩 ${count(w2, E.GUNPOWDER)}/${powderTotal}）`, count(w2, E.GUNPOWDER) < powderTotal / 2);
}

// 13. 盐×水 → 溶解（石碗锁水，盐从上方落入水中）
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let x = 24; x <= 36; x++) w2.set(35 * W + x, E.STONE); // 池底
  for (let y = 31; y <= 34; y++) {
    w2.set(y * W + 27, E.STONE);
    w2.set(y * W + 33, E.STONE);
  } // 池壁
  for (let y = 32; y <= 34; y++) {
    for (let x = 28; x <= 32; x++) w2.set(y * W + x, E.WATER);
  }
  w2.paint(30, 30, 2, E.SALT);
  const saltBefore = count(w2, E.SALT);
  for (let s = 0; s < 300; s++) w2.step();
  check('盐×水 → 触发 dissolve 发现', disc.includes('dissolve'));
  check(`盐逐渐消散（${saltBefore} → ${count(w2, E.SALT)}）`, count(w2, E.SALT) < saltBefore);
}

// 14. 酸×石 → 腐蚀（石碗锁酸：圆顶裸露台上酸液会流走，接触时间不够）
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let x = 24; x <= 36; x++) w2.set(35 * W + x, E.STONE); // 碗底
  for (let y = 31; y <= 34; y++) {
    w2.set(y * W + 24, E.STONE);
    w2.set(y * W + 36, E.STONE);
  } // 碗壁
  const stoneBefore = count(w2, E.STONE);
  w2.paint(30, 33, 2, E.ACID); // 酸困在碗里，与碗底持续接触
  for (let s = 0; s < 150; s++) w2.step();
  check('酸×石 → 触发 corrode 发现', disc.includes('corrode'));
  check(`石头被腐蚀（${stoneBefore} → ${count(w2, E.STONE)}）`, count(w2, E.STONE) < stoneBefore);
}

// 15. 玻璃抗酸
{
  const w2 = new World(W, H, () => {});
  w2.paint(30, 36, 3, E.GLASS);
  const glassBefore = count(w2, E.GLASS);
  w2.paint(30, 31, 2, E.ACID);
  for (let s = 0; s < 200; s++) w2.step();
  check(`玻璃抗酸（${glassBefore} → ${count(w2, E.GLASS)}）`, count(w2, E.GLASS) === glassBefore);
}

// 16. 七张初始地图生成冒烟：不抛错、填充量合理
{
  const { MAPS, generateMap } = await import('../src/sim/maps.js');
  let allOk = MAPS.length === 7;
  const fills = [];
  for (const m of MAPS) {
    const w = makeWorld();
    try {
      generateMap(w, m.id);
    } catch (e) {
      allOk = false;
      console.log(`  地图 ${m.id} 抛错: ${e.message}`);
    }
    let n = 0;
    for (const c of w.cells) if (c !== E.EMPTY) n++;
    fills.push(`${m.id}:${(n / w.cells.length * 100).toFixed(0)}%`);
    // 空白画布允许全空，其余地图至少 500 格
    if (m.id !== 'blank' && n < 500) allOk = false;
  }
  check(`七张地图生成（${fills.join(' ')}）`, allOk);
}

// 17. 火山周期喷发：喷发段火口上方出现新熔岩
{
  const { MAPS, generateMap } = await import('../src/sim/maps.js');
  const w = makeWorld();
  generateMap(w, 'volcano');
  const { volcanoTick } = { volcanoTick: MAPS.find((m) => m.id === 'volcano').tick };
  const countLava = (world) => {
    let n = 0;
    for (const c of world.cells) if (c === E.LAVA) n++;
    return n;
  };
  const before = countLava(w);
  // 跳到喷发段中段驱动 60 帧
  w.frame = 1500 * 2 + 60;
  for (let i = 0; i < 60; i++) {
    w.step();
    volcanoTick(w, w.frame);
  }
  check(`火山喷发新增熔岩（${before} → ${countLava(w)}）`, countLava(w) > before);
}

// 18. 火药爆破破坏固体方块
{
  const w2 = new World(W, H, () => {});
  for (let x = 24; x <= 36; x++) w2.set(35 * W + x, E.STONE); // 石台
  const stoneBefore = count(w2, E.STONE);
  w2.paint(30, 33, 2, E.GUNPOWDER);
  w2.paint(30, 30, 1, E.FIRE);
  for (let s = 0; s < 40; s++) w2.step();
  check(`爆破摧毁石台（${stoneBefore} → ${count(w2, E.STONE)}）`, count(w2, E.STONE) < stoneBefore - 5);
}

// 19. 群岛海啸：tick 到点后岸侧出现新水墙
{
  const { MAPS, generateMap } = await import('../src/sim/maps.js');
  const w2 = makeWorld();
  generateMap(w2, 'archipelago');
  const tick = MAPS.find((m) => m.id === 'archipelago').tick;
  const totalWater = () => {
    let n = 0;
    for (const c of w2.cells) if (c === E.WATER) n++;
    return n;
  };
  const before = totalWater();
  w2.frame = 3600;
  tick(w2, w2.frame);
  check(`海啸注入水墙（${before} → ${totalWater()}）`, totalWater() > before);
}

// 22. 土元素：土陶 + 栽培
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let y = 30; y <= 34; y++) for (let x = 30; x <= 34; x++) w2.set(y * W + x, E.SOIL);
  for (let y = 30; y <= 34; y++) for (let x = 35; x <= 38; x++) w2.set(y * W + x, E.LAVA);
  for (let s = 0; s < 60; s++) w2.step();
  check('熔岩×土 → 触发 soil_brick 发现', disc.includes('soil_brick'));
  check('接触面土被烧成石', count(w2, E.STONE) > 3);

  const disc2 = [];
  const w3 = new World(W, H, (k) => disc2.push(k));
  for (let x = 24; x <= 36; x++) w3.set(35 * W + x, E.STONE);
  w3.paint(28, 33, 3, E.PLANT);
  w3.paint(32, 33, 2, E.SOIL);
  const plantBefore = count(w3, E.PLANT);
  for (let s = 0; s < 600; s++) w3.step();
  check('土×植物 → 触发 soil_grow 发现', disc2.includes('soil_grow'));
  check('植物在土上蔓延（' + plantBefore + ' → ' + count(w3, E.PLANT) + '）', count(w3, E.PLANT) > plantBefore);
}

// 23. 雪：遇火/盐融水
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let x = 26; x <= 34; x++) w2.set(30 * W + x, E.SNOW);
  for (let x = 26; x <= 34; x++) w2.set(31 * W + x, E.FIRE, 60); // 带寿命的火
  for (let s = 0; s < 60; s++) w2.step();
  check('雪×火 → 触发 snow_melt 发现', disc.includes('snow_melt'));
  const snowLeft = count(w2, E.SNOW);
  check('雪融为水（雪 ' + snowLeft + ' → 剩 ≤6）', snowLeft <= 6);

  const disc2 = [];
  const w3 = new World(W, H, (k) => disc2.push(k));
  for (let x = 26; x <= 32; x++) w3.set(31 * W + x, E.SNOW);
  for (let x = 26; x <= 32; x++) w3.set(30 * W + x, E.SALT); // 盐铺在雪层上方
  const snowBefore = count(w3, E.SNOW);
  for (let s = 0; s < 400; s++) w3.step();
  check('盐 × 雪 → 触发 snow_melt 发现', disc2.includes('snow_melt'));
  check('盐融雪（' + snowBefore + ' → ' + count(w3, E.SNOW) + '）', count(w3, E.SNOW) < snowBefore);
}

// 24. 世界分享码：编码 → 解码往返一致
{
  const { encodeShareCode, decodeShareCode } = await import('../src/utils/shareCode.js');
  const w = makeWorld();
  w.seedWorld();
  const code = encodeShareCode(w);
  const decoded = decodeShareCode(code);
  let same = !!decoded && decoded.w === W && decoded.h === H;
  if (same) {
    for (let i = 0; i < w.cells.length; i++) {
      if (decoded.cells[i] !== w.cells[i]) {
        same = false;
        break;
      }
    }
  }
  check(`分享码往返一致（码长 ${code.length} 字符）`, same);
}

// 25. 分享码尺寸适配：放大不丢格；缩小水平居中 + 底对齐保地形
{
  const { encodeShareCode, decodeShareCode, resampleToGrid } = await import('../src/utils/shareCode.js');
  const w = makeWorld();
  w.seedWorld();
  const decoded = decodeShareCode(encodeShareCode(w));
  let srcCount = 0;
  for (const v of decoded.cells) if (v !== E.EMPTY) srcCount++;
  const big = resampleToGrid(decoded, W + 40, H + 40);
  let bigCount = 0;
  for (const v of big) if (v !== E.EMPTY) bigCount++;
  const small = resampleToGrid(decoded, 30, 30);
  let smallCount = 0;
  for (const v of small) if (v !== E.EMPTY) smallCount++;
  // 缩小后源最底行应完整出现在目标最底行（水平居中：目标 x=0..29 ← 源 x=15..44）
  let bottomOk = true;
  for (let x = 0; x < 30; x++) {
    if (small[29 * 30 + x] !== decoded.cells[(H - 1) * W + (x + 15)]) {
      bottomOk = false;
      break;
    }
  }
  check(`分享码放大适配不丢格（${srcCount} → ${bigCount}）`, bigCount === srcCount);
  check(`分享码缩小适配底对齐（剩 ${smallCount}/${srcCount}，底行一致=${bottomOk}）`, smallCount <= srcCount && bottomOk);
}

// 26. 分享码防伪：乱码 / 空串 / 魔数不符一律拒绝
{
  const { decodeShareCode } = await import('../src/utils/shareCode.js');
  const bad = decodeShareCode('garbage-input');
  const empty = decodeShareCode('');
  check('分享码防伪（乱码与空串均拒绝）', bad === null && empty === null);
}

// 27. 电：×水导电传播，寿命尽消散、水回归
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let x = 24; x <= 36; x++) w2.set(35 * W + x, E.STONE); // 池底
  for (let y = 31; y <= 34; y++) {
    w2.set(y * W + 27, E.STONE);
    w2.set(y * W + 33, E.STONE);
  } // 池壁
  for (let y = 32; y <= 34; y++) {
    for (let x = 28; x <= 32; x++) w2.set(y * W + x, E.WATER);
  }
  w2.paint(30, 33, 1, E.ELECTRIC); // 往水里画电
  let electrified = 0;
  for (let s = 0; s < 10; s++) {
    w2.step();
    for (let i = 0; i < w2.cells.length; i++) {
      if (w2.cells[i] === E.WATER && w2.life[i] > 0) electrified++;
    }
  }
  check('电 × 水 → 触发 conduct 发现', disc.includes('conduct'));
  check(`水体被通电（采样期带电格峰值计 ${electrified}）`, electrified > 0);
  for (let s = 0; s < 240; s++) w2.step();
  check(`火花消散、水回归（剩电 ${count(w2, E.ELECTRIC)}）`, count(w2, E.ELECTRIC) === 0 && count(w2, E.WATER) > 0);
}

// 28. 电 × 沙 → 闪玻璃（雷击熔沙）
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let x = 24; x <= 36; x++) w2.set(35 * W + x, E.STONE);
  for (let y = 32; y <= 34; y++) {
    for (let x = 28; x <= 32; x++) w2.set(y * W + x, E.SAND);
  }
  w2.paint(30, 31, 2, E.ELECTRIC); // 紧贴沙堆上方撒一把电火花
  for (let s = 0; s < 120; s++) w2.step();
  check('电 × 沙 → 触发 fulgurite 发现', disc.includes('fulgurite'));
  check('沙被雷熔成玻璃', count(w2, E.GLASS) > 0);
}

// 29. 电 × 植物 → 焦枯；电 × 火药 → 殉爆；电 × 雪 → 融水
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let x = 24; x <= 36; x++) w2.set(35 * W + x, E.STONE);
  w2.paint(28, 33, 2, E.PLANT);
  w2.paint(28, 30, 1, E.ELECTRIC); // 植物冠顶上方
  for (let s = 0; s < 60; s++) w2.step();
  check('电 × 植物 → 触发 scorch 发现', disc.includes('scorch'));

  const disc2 = [];
  const w3 = new World(W, H, (k) => disc2.push(k));
  for (let x = 24; x <= 36; x++) w3.set(35 * W + x, E.STONE);
  w3.paint(30, 33, 3, E.GUNPOWDER);
  w3.paint(30, 30, 1, E.ELECTRIC); // 火药堆上方
  for (let s = 0; s < 40; s++) w3.step();
  check('电 × 火药 → 触发 boom 发现', disc2.includes('boom'));

  const disc3 = [];
  const w4 = new World(W, H, (k) => disc3.push(k));
  for (let x = 26; x <= 34; x++) w4.set(31 * W + x, E.STONE); // 石台托住雪，防止雪掉走、火花追不上
  for (let x = 26; x <= 34; x++) w4.set(30 * W + x, E.SNOW);
  w4.paint(30, 29, 2, E.ELECTRIC); // 雪层正上方，火花悬停即持续接触
  for (let s = 0; s < 60; s++) w4.step();
  check('电 × 雪 → 触发 snow_melt 发现', disc3.includes('snow_melt'));
  check('雪被电融（剩 ' + count(w4, E.SNOW) + '）', count(w4, E.SNOW) < 9);
}

// 30. 通电水 × 火药 → 水中传导引爆
{
  const disc = [];
  const w2 = new World(W, H, (k) => disc.push(k));
  for (let x = 24; x <= 36; x++) w2.set(35 * W + x, E.STONE); // 池底兼石台
  for (let y = 31; y <= 34; y++) {
    w2.set(y * W + 24, E.STONE);
    w2.set(y * W + 36, E.STONE);
  }
  for (let y = 32; y <= 34; y++) {
    for (let x = 25; x <= 35; x++) w2.set(y * W + x, E.WATER);
  }
  w2.paint(30, 33, 3, E.GUNPOWDER); // 火药沉入池底
  w2.paint(30, 32, 1, E.ELECTRIC); // 水中央通电
  for (let s = 0; s < 60; s++) w2.step();
  check('通电水 × 火药 → 触发 boom 发现', disc.includes('boom'));
}

// 9. 性能：10 秒模拟量（600 帧）耗时应远小于 10 秒
{
  const w = makeWorld();
  w.seedWorld();
  const t0 = performance.now();
  for (let s = 0; s < 600; s++) w.step();
  const ms = performance.now() - t0;
  check(`600 帧模拟耗时 ${ms.toFixed(0)}ms（阈值 3000ms）`, ms < 3000);
}

console.log(failed === 0 ? '\n🎉 全部通过' : `\n💥 ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
