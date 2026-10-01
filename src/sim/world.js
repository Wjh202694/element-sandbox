import { E, DENSITY, FLAMMABLE, SOLUBLE, isFluid, isGas } from './elements.js';

const rand = Math.random;
const DX8 = [1, -1, 0, 0, 1, -1, 1, -1];
const DY8 = [0, 0, 1, -1, 1, 1, -1, -1];
const DX4 = [1, -1, 0, 0];
const DY4 = [0, 0, 1, -1];

/**
 * 细胞自动机世界：Uint8Array 网格 + 每帧自底向上扫描，
 * 左右方向逐帧交替防漂移；moved 标记保证一格一帧只动一次。
 */
export class World {
  constructor(w, h, onDiscover) {
    this.w = w;
    this.h = h;
    this.cells = new Uint8Array(w * h);
    this.life = new Uint8Array(w * h);
    this.shade = new Uint8Array(w * h);
    this.moved = new Uint8Array(w * h);
    this.frame = 0;
    this.dirty = false;
    this.onDiscover = onDiscover || (() => {});
    for (let i = 0; i < this.shade.length; i++) this.shade[i] = (rand() * 256) | 0;
  }

  inBounds(x, y) {
    return x >= 0 && x < this.w && y >= 0 && y < this.h;
  }

  discover(key) {
    this.onDiscover(key);
  }

  set(i, id, life = 0) {
    this.cells[i] = id;
    this.life[i] = life;
    this.shade[i] = (rand() * 256) | 0;
    this.dirty = true;
  }

  swap(i, j) {
    let t;
    t = this.cells[i]; this.cells[i] = this.cells[j]; this.cells[j] = t;
    t = this.life[i]; this.life[i] = this.life[j]; this.life[j] = t;
    t = this.shade[i]; this.shade[i] = this.shade[j]; this.shade[j] = t;
    this.moved[i] = 1;
    this.moved[j] = 1;
    this.dirty = true;
  }

  moveTo(i, j) {
    this.cells[j] = this.cells[i];
    this.life[j] = this.life[i];
    this.shade[j] = this.shade[i];
    this.cells[i] = E.EMPTY;
    this.life[i] = 0;
    this.moved[j] = 1;
    this.dirty = true;
  }

  clear() {
    this.cells.fill(E.EMPTY);
    this.life.fill(0);
    this.dirty = true;
  }

  step() {
    this.frame++;
    this.moved.fill(0);
    const flip = this.frame & 1;
    for (let y = this.h - 1; y >= 0; y--) {
      const row = y * this.w;
      for (let k = 0; k < this.w; k++) {
        const x = flip ? k : this.w - 1 - k;
        const i = row + x;
        if (this.moved[i]) continue;
        const id = this.cells[i];
        if (id === E.SAND) this.updatePowder(i, x, y, E.SAND, 'sink');
        else if (id === E.WATER) this.updateWater(i, x, y);
        else if (id === E.OIL) this.updateOil(i, x, y);
        else if (id === E.FIRE) this.updateFire(i, x, y);
        else if (id === E.STEAM) this.updateGas(i, x, y, true);
        else if (id === E.SMOKE) this.updateGas(i, x, y, false);
        else if (id === E.LAVA) this.updateLava(i, x, y);
        else if (id === E.ACID) this.updateAcid(i, x, y);
        else if (id === E.SALT) this.updateSalt(i, x, y);
        else if (id === E.GUNPOWDER) this.updatePowder(i, x, y, E.GUNPOWDER, null);
        else if (id === E.SOIL) this.updateSoil(i, x, y);
        else if (id === E.SNOW) this.updateSnow(i, x, y);
        else if (id === E.ELECTRIC) this.updateElectric(i, x, y);
        else if (id === E.METAL && this.life[i] > 0) this.updateConductor(i, x, y);
        else if (id === E.H2) this.updateHydrogen(i, x, y);
      }
    }
  }

  // 粉末行为：沙/火药/盐共用（下落、堆积、沉入液体）
  updatePowder(i, x, y, id, discKey) {
    if (y + 1 >= this.h) return;
    const below = i + this.w;
    const b = this.cells[below];
    if (b === E.EMPTY) return this.moveTo(i, below);
    if (isFluid(b)) return this.trySink(i, below, id, b, discKey);
    const d = rand() < 0.5 ? 1 : -1;
    for (let n = 0; n < 2; n++) {
      const dx = n === 0 ? d : -d;
      const nx = x + dx;
      if (nx < 0 || nx >= this.w) continue;
      const j = below + dx;
      const c = this.cells[j];
      if (c === E.EMPTY) return this.moveTo(i, j);
      if (isFluid(c)) return this.trySink(i, j, id, c, discKey);
    }
  }

  // 重者沉入轻者液体
  trySink(i, j, id, target, discKey) {
    if (DENSITY[id] > DENSITY[target]) {
      if (discKey) this.discover(discKey);
      this.swap(i, j);
    }
  }

  // 通电体公共传播（水与金属共用）：新鲜期（life>6）波前扩散 + 引爆火药 + 灼焦植物；
  // 静默衰减期不再扩散——否则相邻两格互相回充，永不消散
  updateConductor(i, x, y) {
    this.life[i]--;
    if (this.life[i] > 6) {
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k];
        const ny = y + DY8[k];
        if (!this.inBounds(nx, ny)) continue;
        const j = ny * this.w + nx;
        const c = this.cells[j];
        if (c === E.GUNPOWDER) {
          this.igniteCell(j, c); // 通电体引爆火药
          continue;
        }
        if ((c === E.WATER || c === E.METAL) && this.life[j] === 0) {
          const metal = c === E.METAL || this.cells[i] === E.METAL;
          this.discover(metal ? 'wire' : 'conduct');
          this.set(j, c, 8 + rand() * 8); // 保持原 id，借 life 标记通电
          continue;
        }
        if (c === E.PLANT && rand() < 0.03) {
          this.discover('scorch');
          this.set(j, E.SMOKE, 30 + rand() * 30);
          continue;
        }
      }
    }
  }

  updateWater(i, x, y) {
    // 通电状态（借 life 标记，id 仍是水）：波前传导 + 电解
    if (this.life[i] > 0) {
      this.updateConductor(i, x, y);
      if (this.life[i] > 6) {
        // 电解：偶发冒出电火花（水面噼啪作响的观感来源）
        if (rand() < 0.02) {
          this.discover('electrolysis');
          if (y > 0 && this.cells[i - this.w] === E.EMPTY && rand() < 0.5) {
            this.set(i - this.w, E.ELECTRIC, 5 + rand() * 8);
          }
        }
        // 电解得氢：偶发从水中冒出氢气（与电火花同级，电解水真的冒氢）
        if (rand() < 0.04) {
          this.discover('hydrogen');
          if (y > 0 && this.cells[i - this.w] === E.EMPTY) {
            this.set(i - this.w, E.H2, 200 + rand() * 100);
          }
        }
      }
      if (rand() < 0.006) {
        // 电解汽化：少量水电解成蒸汽逸出
        this.discover('electrolysis');
        this.set(i, E.STEAM, 100 + rand() * 60);
        return;
      }
      return; // 通电期间驻留不流动，让波前完整走完
    }
    // 遇植物：水被吸收，藤蔓生长（速率压低，防海上藻类疯长）
    if (rand() < 0.004) {
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k];
        const ny = y + DY8[k];
        if (!this.inBounds(nx, ny)) continue;
        if (this.cells[ny * this.w + nx] === E.PLANT) {
          this.discover('growth');
          this.set(i, E.PLANT);
          return;
        }
      }
    }
    // 遇熔岩：水汽化，熔岩冷淬成石（与 updateLava 互为镜像，谁先更新都成立）
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k];
      const ny = y + DY4[k];
      if (!this.inBounds(nx, ny)) continue;
      const j = ny * this.w + nx;
      if (this.cells[j] === E.LAVA) {
        this.discover('lava_stone');
        this.set(j, E.STONE);
        this.set(i, E.STEAM, 140 + rand() * 90);
        return;
      }
      // 火药遇水受潮成哑火
      if (this.cells[j] === E.GUNPOWDER && rand() < 0.25) {
        this.discover('damp');
        this.set(j, E.EMPTY);
        return;
      }
    }
    this.flow(i, x, y, E.WATER);
  }

  updateOil(i, x, y) {
    if (y + 1 < this.h && this.cells[i + this.w] === E.WATER) this.discover('float');
    this.flow(i, x, y, E.OIL);
  }

  // 液体流动：下落 / 斜落 / 横向铺展；disp=铺展视野，spread=铺展意愿（熔岩更黏稠）
  flow(i, x, y, id, opts = {}) {
    const disp = opts.disp ?? 4;
    const spread = opts.spread ?? 0.85;
    const dens = DENSITY[id];
    if (y + 1 < this.h) {
      const j = i + this.w;
      const b = this.cells[j];
      if (b === E.EMPTY) return this.moveTo(i, j);
      if (isFluid(b) && dens > DENSITY[b]) {
        if (id === E.WATER && b === E.OIL) this.discover('float');
        return this.swap(i, j);
      }
      if (isGas(b)) return this.swap(i, j);
      const d = rand() < 0.5 ? 1 : -1;
      for (let n = 0; n < 2; n++) {
        const dx = n === 0 ? d : -d;
        const nx = x + dx;
        if (nx < 0 || nx >= this.w) continue;
        const j2 = j + dx;
        const c = this.cells[j2];
        if (c === E.EMPTY) return this.moveTo(i, j2);
        if (isFluid(c) && dens > DENSITY[c]) return this.swap(i, j2);
        if (isGas(c)) return this.swap(i, j2);
      }
    }
    // 横向铺展，让液体快速找平
    const dir = rand() < 0.5 ? 1 : -1;
    let best = -1;
    for (let s = 1; s <= disp; s++) {
      const nx = x + dir * s;
      if (nx < 0 || nx >= this.w) break;
      const j = i + dir * s;
      if (this.cells[j] === E.EMPTY) best = j;
      else break;
    }
    if (best !== -1 && rand() < spread) this.moveTo(i, best);
  }

  updateFire(i, x, y) {
    if (this.life[i] > 0) this.life[i]--;
    if (this.life[i] === 0) {
      if (rand() < 0.35) {
        this.discover('smoke');
        this.set(i, E.SMOKE, 50 + rand() * 60);
      } else {
        this.set(i, E.EMPTY);
      }
      return;
    }
    // 8 向点燃：粉末斜滑流动时也能被咬住
    for (let k = 0; k < 8; k++) {
      const nx = x + DX8[k];
      const ny = y + DY8[k];
      if (!this.inBounds(nx, ny)) continue;
      const j = ny * this.w + nx;
      const c = this.cells[j];
      if (c === E.WATER) {
        this.discover('steam');
        if (rand() < 0.4) this.set(j, E.STEAM, 140 + rand() * 90);
        this.set(i, E.SMOKE, 30 + rand() * 40);
        return;
      }
      const f = FLAMMABLE[c];
      if (f && rand() < f.chance) this.igniteCell(j, c);
    }
    // 火苗偶尔上蹿（概率低让燃料在原地经历完整的余烬渐变）
    if (y > 0 && rand() < 0.04) {
      const j = i - this.w;
      if (this.cells[j] === E.EMPTY) this.moveTo(i, j);
    }
  }

  // 电：短寿命能量火花。遇水把能量交给整片水体（波前传导），
  // 遇火药殉爆、雷击熔沙成「闪玻璃」、灼焦植物、融化雪，寿命尽即消散。
  updateElectric(i, x, y) {
    if (this.life[i] > 0) this.life[i]--;
    if (this.life[i] === 0) {
      this.set(i, E.EMPTY);
      return;
    }
    for (let k = 0; k < 8; k++) {
      const nx = x + DX8[k];
      const ny = y + DY8[k];
      if (!this.inBounds(nx, ny)) continue;
      const j = ny * this.w + nx;
      const c = this.cells[j];
      if ((c === E.WATER || c === E.METAL) && this.life[j] === 0) {
        this.discover(c === E.METAL ? 'wire' : 'conduct');
        this.set(j, c, 8 + rand() * 8);
        this.set(i, E.EMPTY); // 能量交出去，火花本身消散
        return;
      }
      if (c === E.GUNPOWDER) {
        this.igniteCell(j, c); // 走统一殉爆入口（含 boom 发现 + 爆破）
        continue;
      }
      if (c === E.PLANT && rand() < 0.25) {
        this.discover('scorch');
        this.set(j, E.SMOKE, 30 + rand() * 30);
        continue;
      }
      if (c === E.SAND && rand() < 0.15) {
        this.discover('fulgurite');
        this.set(j, E.GLASS); // 雷击熔沙，真实世界的闪电熔玻璃
        continue;
      }
      if (c === E.SNOW && rand() < 0.4) {
        this.discover('snow_melt');
        this.set(j, E.WATER);
        continue;
      }
      const f = FLAMMABLE[c];
      if (f && rand() < f.chance * 0.4) this.igniteCell(j, c); // 弱于明火：电弧偶尔点燃油木
    }
    // 无规则乱窜（等离子火花感）
    const d = (rand() * 4) | 0;
    const nx = x + DX4[d];
    const ny = y + DY4[d];
    if (this.inBounds(nx, ny) && this.cells[ny * this.w + nx] === E.EMPTY && rand() < 0.8) {
      this.moveTo(i, ny * this.w + nx);
    }
  }

  updateGas(i, x, y, isSteam) {
    if (this.life[i] > 0) this.life[i]--;
    if (this.life[i] === 0) {
      if (isSteam && rand() < 0.35) {
        this.discover('rain');
        this.set(i, E.WATER);
      } else {
        this.set(i, E.EMPTY);
      }
      return;
    }
    if (y > 0) {
      const up = i - this.w;
      const a = this.cells[up];
      if (a === E.EMPTY) return this.moveTo(i, up);
      if (isFluid(a)) return this.swap(i, up); // 气泡穿水
      const d = rand() < 0.5 ? 1 : -1;
      for (let n = 0; n < 2; n++) {
        const dx = n === 0 ? d : -d;
        const nx = x + dx;
        if (nx < 0 || nx >= this.w) continue;
        const j = up + dx;
        if (this.cells[j] === E.EMPTY) return this.moveTo(i, j);
      }
    }
    const dx2 = rand() < 0.5 ? 1 : -1;
    const nx2 = x + dx2;
    if (nx2 >= 0 && nx2 < this.w && this.cells[i + dx2] === E.EMPTY && rand() < 0.35) {
      this.moveTo(i, i + dx2);
    }
  }

  // 统一 ignition 入口：按目标类型触发对应发现；火药殉爆并破坏固体
  igniteCell(j, c) {
    const f = FLAMMABLE[c];
    if (c === E.OIL) this.discover('oil_burn');
    else if (c === E.WOOD) this.discover('wood_burn');
    else if (c === E.GUNPOWDER) {
      this.discover('boom');
      this.set(j, E.FIRE, f.burn * (0.7 + rand() * 0.6));
      this.blast(j % this.w, (j / this.w) | 0);
      return;
    }
    this.set(j, E.FIRE, f.burn * (0.7 + rand() * 0.6));
  }

  // 爆破：清空半径内固体方块（含连锁殉爆），边缘留残渣与烟
  blast(cx, cy) {
    this.onBlast?.(cx, cy);
    const R = 3;
    const R2 = R * R;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > R2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.inBounds(x, y)) continue;
        const i = y * this.w + x;
        const c = this.cells[i];
        if (c === E.GUNPOWDER) {
          this.igniteCell(i, c); // 连锁殉爆
          continue;
        }
        if (c === E.STONE || c === E.WOOD || c === E.PLANT || c === E.GLASS || c === E.SAND || c === E.SOIL) {
          if (rand() < 0.85 - (d2 / R2) * 0.35) {
            this.set(i, rand() < 0.2 ? E.SMOKE : E.EMPTY, 40 + rand() * 40);
          }
        }
      }
    }
  }

  // 熔岩：黏稠热液，点燃可燃物、烧沙成玻璃、遇水冷淬成石
  updateLava(i, x, y) {
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k];
      const ny = y + DY4[k];
      if (!this.inBounds(nx, ny)) continue;
      const j = ny * this.w + nx;
      const c = this.cells[j];
      if (c === E.WATER) {
        this.discover('lava_stone');
        this.set(i, E.STONE);
        this.set(j, E.STEAM, 140 + rand() * 90);
        return;
      }
      if (c === E.SAND && rand() < 0.03) {
        this.discover('glass');
        this.set(j, E.GLASS);
        continue;
      }
      if (c === E.ACID && rand() < 0.3) {
        // 酸被煮沸成毒雾
        this.discover('acid_boil');
        this.set(j, E.SMOKE, 40 + rand() * 40);
        continue;
      }
      if (c === E.METAL && rand() < 0.08) {
        // 高温熔化金属
        this.discover('melt_metal');
        this.set(j, E.LAVA);
        continue;
      }
      if (c === E.GLASS && rand() < 0.02) {
        // 高温重熔玻璃
        this.discover('glass_melt');
        this.set(j, E.LAVA);
        continue;
      }
      if (c === E.SOIL && rand() < 0.08) {
        // 高温烧土成陶
        this.discover('soil_brick');
        this.set(j, E.STONE);
        continue;
      }
      const f = FLAMMABLE[c];
      if (f && rand() < f.chance * 0.5) {
        this.discover('lava_fire');
        this.igniteCell(j, c);
      }
    }
    // 偶尔舔出火苗
    if (y > 0 && rand() < 0.004 && this.cells[i - this.w] === E.EMPTY) {
      this.set(i - this.w, E.FIRE, 30 + rand() * 30);
    }
    this.flow(i, x, y, E.LAVA, { disp: 2, spread: 0.5 });
  }

  // 酸：腐蚀大多数固体（玻璃抗酸），遇水缓慢稀释
  updateAcid(i, x, y) {
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k];
      const ny = y + DY4[k];
      if (!this.inBounds(nx, ny)) continue;
      const j = ny * this.w + nx;
      const c = this.cells[j];
      if (SOLUBLE.has(c)) {
        if (rand() < 0.06) {
          if (c === E.STONE) this.discover('corrode');
          else if (c === E.OIL) this.discover('acid_oil');
          else if (c === E.SALT) this.discover('acid_salt');
          else if (c === E.METAL) this.discover('etch');
          this.set(j, E.EMPTY);
          if (rand() < 0.3) {
            // 每次腐蚀有概率消耗自身
            this.set(i, E.EMPTY);
            return;
          }
        }
      } else if (c === E.WATER && rand() < 0.004) {
        this.set(i, E.WATER);
        return;
      }
    }
    this.flow(i, x, y, E.ACID);
  }

  // 土：粉末类；贴植物会滋生蔓延（栽培）
  updateSoil(i, x, y) {
    if (rand() < 0.006) {
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k];
        const ny = y + DY8[k];
        if (!this.inBounds(nx, ny)) continue;
        if (this.cells[ny * this.w + nx] === E.PLANT) {
          this.discover('soil_grow');
          this.set(i, E.PLANT);
          return;
        }
      }
    }
    this.updatePowder(i, x, y, E.SOIL, null);
  }

  // 雪：粉末类；遇高温/盐/水融化成水
  updateSnow(i, x, y) {
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k];
      const ny = y + DY4[k];
      if (!this.inBounds(nx, ny)) continue;
      const c = this.cells[ny * this.w + nx];
      let melt = 0;
      if (c === E.FIRE || c === E.LAVA) melt = 0.4;
      else if (c === E.SALT) melt = 0.15;
      else if (c === E.WATER) melt = 0.02;
      if (melt && rand() < melt) {
        this.discover('snow_melt');
        this.set(i, E.WATER);
        return;
      }
    }
    this.updatePowder(i, x, y, E.SNOW, null);
  }

  // 盐：入水缓慢溶解；贴植物则吸水枯死
  updateSalt(i, x, y) {    if (rand() < 0.05) {
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k];
        const ny = y + DY4[k];
        if (!this.inBounds(nx, ny)) continue;
        if (this.cells[ny * this.w + nx] === E.WATER) {
          this.discover('dissolve');
          this.set(i, E.WATER);
          return;
        }
      }
    }
    if (rand() < 0.02) {
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k];
        const ny = y + DY4[k];
        if (!this.inBounds(nx, ny)) continue;
        const j = ny * this.w + nx;
        if (this.cells[j] === E.PLANT) {
          this.discover('wither');
          this.set(j, E.EMPTY);
          return;
        }
      }
    }
    this.updatePowder(i, x, y, E.SALT, null);
  }

  // 氢气：最轻气体，快速上浮；只被明火/熔岩引爆成水（氢氧相激，物质循环）。
  // 电火花不引爆氢——否则电解火花比产氢频繁，氢包永远攒不起来
  updateHydrogen(i, x, y) {
    for (let k = 0; k < 8; k++) {
      const nx = x + DX8[k];
      const ny = y + DY8[k];
      if (!this.inBounds(nx, ny)) continue;
      const c = this.cells[ny * this.w + nx];
      if (c === E.FIRE || c === E.LAVA) {
        this.discover('detonate');
        this.set(i, E.WATER); // 燃烧产物：氢氧结合成水
        this.blast(x, y); // 氢爆当量不小，冲击波照常结算
        return;
      }
    }
    // 上浮（比蒸汽更快），水中穿行，天顶缓慢逃逸
    if (y > 0) {
      const up = i - this.w;
      if (this.cells[up] === E.EMPTY && rand() < 0.9) return this.moveTo(i, up);
      if (isFluid(this.cells[up]) && rand() < 0.8) return this.swap(i, up);
    }
    const d = (rand() * 4) | 0;
    const nx = x + DX4[d];
    const ny = y + DY4[d];
    if (this.inBounds(nx, ny) && this.cells[ny * this.w + nx] === E.EMPTY && rand() < 0.4) {
      this.moveTo(i, ny * this.w + nx);
    }
    if (y === 0 && rand() < 0.004) this.set(i, E.EMPTY); // 逃逸大气
  }

  spawnLife(id) {
    if (id === E.FIRE) return 40 + rand() * 40;
    if (id === E.STEAM) return 140 + rand() * 90;
    if (id === E.SMOKE) return 50 + rand() * 60;
    if (id === E.ELECTRIC) return 8 + rand() * 10;
    return 0;
  }

  paint(cx, cy, r, id) {
    const r2 = r * r;
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.inBounds(x, y)) continue;
        const i = y * this.w + x;
        if (id === E.EMPTY) {
          if (this.cells[i] !== E.EMPTY) {
            this.set(i, E.EMPTY);
            n++;
          }
          continue;
        }
        const c = this.cells[i];
        if (c === E.EMPTY) {
          this.set(i, id, this.spawnLife(id));
          n++;
        } else if (id === E.ELECTRIC && (c === E.WATER || c === E.METAL)) {
          // 往水里/金属上画电：直接通电（波前从落点扩散）
          if (this.life[i] === 0) {
            this.discover(c === E.METAL ? 'wire' : 'conduct');
            this.set(i, c, 8 + rand() * 8);
            n++;
          }
        } else if (id === E.ELECTRIC && c === E.PLANT) {
          // 电直接触植物：焦枯成烟（区别于火的点燃）
          this.discover('scorch');
          this.set(i, E.SMOKE, 30 + rand() * 30);
          n++;
        } else if ((id === E.FIRE || id === E.ELECTRIC) && FLAMMABLE[c]) {
          // 画火/电直接走统一点燃入口（火药落点即爆）
          this.igniteCell(i, c);
          n++;
        }
      }
    }
    return n;
  }

  load(cells) {
    this.cells.set(cells);
    for (let i = 0; i < this.cells.length; i++) {
      const id = this.cells[i];
      this.life[i] = this.spawnLife(id);
      this.shade[i] = (rand() * 256) | 0;
    }
    this.dirty = true;
  }

  // 初始小场景：石基 + 水潭 + 沙丘 + 木桩树冠，打开即有东西可玩
  seedWorld() {
    const { w, h } = this;
    const waterLine = h - 40;
    const surf = new Array(w);
    for (let x = 0; x < w; x++) {
      let g = waterLine + Math.round(2 * Math.sin(x * 0.05) + 2 * Math.sin(x * 0.017 + 1.5));
      const t = (x - w * 0.42) / (w * 0.13);
      if (Math.abs(t) < 1) g = Math.max(g, waterLine + Math.round(7 * (1 - t * t)));
      surf[x] = g;
      const top = Math.min(g, waterLine);
      for (let y = top; y < h; y++) {
        const i = y * w + x;
        if (y < g) this.set(i, E.WATER);
        else if (y < g + 2) this.set(i, E.SAND);
        else this.set(i, E.STONE);
      }
    }
    // 左侧沙丘
    const dx0 = Math.floor(w * 0.15);
    for (let dx = -15; dx <= 15; dx++) {
      const x = dx0 + dx;
      if (x < 0 || x >= w) continue;
      const hgt = Math.round(6 * (1 - (dx / 15) ** 2));
      for (let k = 1; k <= hgt; k++) {
        const y = surf[x] - k;
        if (y >= 0 && this.cells[y * w + x] === E.EMPTY) this.set(y * w + x, E.SAND);
      }
    }
    // 右侧木桩 + 树冠
    const tx = Math.floor(w * 0.76);
    const base = surf[tx] - 1;
    for (let y = base - 15; y <= base; y++) {
      for (let dx = -1; dx <= 1; dx++) this.set(y * w + tx + dx, E.WOOD);
    }
    const cy = base - 17;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy * 1.4 <= 10) {
          const y = cy + dy;
          const x = tx + dx;
          if (x >= 0 && x < w && y >= 0 && this.cells[y * w + x] === E.EMPTY) {
            this.set(y * w + x, E.PLANT);
          }
        }
      }
    }
  }
}
