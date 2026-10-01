/**
 * Minimap — room outlines, your position, your desk and your remaining task spots.
 * It deliberately does NOT show other players; you have to go look.
 */
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  render(game, now) {
    const { ctx, canvas } = this;
    const map = game.map;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw) return;
    if (canvas.width !== Math.round(cw * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const s = Math.min(cw / map.width, ch / map.height);
    const ox = (cw - map.width * s) / 2;
    const oy = (ch - map.height * s) / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, 0, map.width, map.height);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 12;
    for (const r of map.rooms) {
      if (r.hall) continue;
      ctx.fillStyle = r.open ? 'rgba(140, 197, 107, 0.35)' : 'rgba(255,255,255,0.28)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (!r.open) ctx.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    }
    // Building outline
    const hall = map.rooms.find((r) => r.hall);
    if (hall) ctx.strokeRect(hall.x + 6, hall.y + 6, hall.w - 12, hall.h - 12);

    // Task spots
    const pulse = 0.6 + 0.4 * Math.sin(now / 250);
    ctx.fillStyle = `rgba(255, 213, 46, ${pulse})`;
    for (const o of game.taskTargets()) {
      ctx.beginPath();
      ctx.arc(o.x + o.w / 2, o.y + o.h / 2, 38, 0, Math.PI * 2);
      ctx.fill();
    }

    // Own desk
    const desk = game.self?.deskId && map.desksById.get(game.self.deskId);
    if (desk) {
      ctx.strokeStyle = '#54c985';
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(desk.seat.x, desk.seat.y, 50, 0, Math.PI * 2);
      ctx.stroke();
    }

    // You
    if (game.local) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1d2742';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(game.local.x, game.local.y, 42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
