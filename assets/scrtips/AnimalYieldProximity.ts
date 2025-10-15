// assets/scripts/AnimalYieldProximity.ts
import {
  _decorator,
  Component,
  Node,
  UITransform,
  Rect,
  Vec3,
} from "cc";
import {
  pauseNodeMove,
  resumeNodeMove,
  isNodeMovePaused,
} from "./NodeMover";
const { ccclass, property } = _decorator;

/**
 * Nhường đường KHÔNG DÙNG PHYSICS (proximity):
 * - Mỗi frame quét AABB toàn subtree của các animal trong groupRoot.
 * - Nếu AABB chồng nhau -> node có uuid "lớn hơn" sẽ nhường (tạm dừng).
 * - Khi hết chồng -> tự resume.
 */
@ccclass("AnimalYieldProximity")
export class AnimalYieldProximity extends Component {
  @property({ type: Node, tooltip: "Gốc chứa tất cả animals (để trống = parent của node này)" })
  groupRoot: Node | null = null;

  @property({ tooltip: "Bật log debug" })
  debug = false;

  @property({ tooltip: "Hysteresis để xác nhận đã tách (px)" })
  separationPadding = 2;

  @property({
    tooltip:
      "Bán kính fallback (px) khi node KHÔNG có UITransform nào trong subtree. 0 = tắt fallback.",
  })
  fallbackRadius = 36;

  private _blockers = new Set<Node>();
  private _tmpRect = new Rect();
  private _tmpRect2 = new Rect();
  private _tmpV = new Vec3();

  onDisable() {
    // phòng kẹt pause
    if (this._blockers.size > 0) {
      this._blockers.clear();
      resumeNodeMove(this.node);
    }
  }

  update() {
    const root = this.groupRoot ?? this.node.parent;
    if (!root) return;

    const myRect = this.getWorldAABBOfSubtree(this.node, this._tmpRect);

    // Tập các animal peers (cũng gắn component này)
    const peers = root
      .getComponentsInChildren(AnimalYieldProximity)
      .map((c) => c.node)
      .filter((n) => n !== this.node && n.activeInHierarchy);

    let collidedWith: Node | null = null;
    // console.log({peers})
    for (const other of peers) {
      const otherRect = this.getWorldAABBOfSubtree(other, this._tmpRect2);
      const overlapped = rectOverlap(myRect, otherRect);
      if (overlapped) {
        collidedWith = other;
        break;
      }

      // Fallback nếu cả 2 không có AABB hữu dụng: đo theo khoảng cách tâm node
      if (this.fallbackRadius > 0 && isEmptyRect(myRect) && isEmptyRect(otherRect)) {
        this._tmpV.set(this.node.worldPosition);
        this._tmpV.subtract(other.worldPosition);
        const d = this._tmpV.length();
        if (d <= this.fallbackRadius * 2) {
          collidedWith = other;
          break;
        }
      }
    }

    if (collidedWith) {
      // Quy tắc nhường: uuid lớn hơn NHƯỜNG (ổn định, tránh deadlock)
      const yieldNode = this.node.uuid > collidedWith.uuid ? this.node : collidedWith;
      if (yieldNode === this.node) {
        if (!this._blockers.has(collidedWith)) {
          this._blockers.add(collidedWith);
          if (!isNodeMovePaused(this.node)) pauseNodeMove(this.node);
          if (this.debug) console.log("[YieldProximity] PAUSE", this.node.name, "↔", collidedWith.name);
        }
      } else {
        // mình được đi
        this._blockers.delete(collidedWith);
      }
    } else {
      // Không còn chồng: xác nhận thật sự tách với hysteresis
      if (this._blockers.size > 0) {
        const stillBlocked = [...this._blockers].some((n) => {
          const r1 = this.getWorldAABBOfSubtree(this.node, this._tmpRect);
          const r2 = this.getWorldAABBOfSubtree(n, this._tmpRect2);
          return rectOverlap(r1, r2, -this.separationPadding);
        });
        if (!stillBlocked) {
          this._blockers.clear();
          resumeNodeMove(this.node);
          if (this.debug) console.log("[YieldProximity] RESUME", this.node.name);
        }
      }
    }
  }

  /** AABB thế giới của toàn bộ subtree (hợp nhất tất cả UITransform con cháu). Trả Rect(0,0,0,0) nếu không có. */
  private getWorldAABBOfSubtree(n: Node, out: Rect): Rect {
    const uts = n.getComponentsInChildren(UITransform);
    if (!uts || uts.length === 0) {
      out.x = out.y = out.width = out.height = 0;
      return out;
    }
    let first = true;
    for (const ut of uts) {
      const r = ut.getBoundingBoxToWorld();
      if (first) {
        out.set(r);
        first = false;
      } else {
        unionRect(out, r);
      }
    }
    return out;
  }
}

/** AABB chồng nhau; padding>0 siết chặt, padding<0 nới lỏng (dùng cho hysteresis). */
function rectOverlap(a: Rect, b: Rect, padding = 0): boolean {
  if (isEmptyRect(a) || isEmptyRect(b)) return false;
  const ax1 = a.x + padding, ay1 = a.y + padding;
  const ax2 = a.x + a.width - padding, ay2 = a.y + a.height - padding;
  const bx1 = b.x + padding, by1 = b.y + padding;
  const bx2 = b.x + b.width - padding, by2 = b.y + b.height - padding;
  const sep = ax2 < bx1 || bx2 < ax1 || ay2 < by1 || by2 < ay1;
  return !sep;
}

function isEmptyRect(r: Rect): boolean {
  return !(r.width > 0 && r.height > 0);
}

function unionRect(out: Rect, r: Rect): Rect {
  const x1 = Math.min(out.x, r.x);
  const y1 = Math.min(out.y, r.y);
  const x2 = Math.max(out.x + out.width, r.x + r.width);
  const y2 = Math.max(out.y + out.height, r.y + r.height);
  out.x = x1;
  out.y = y1;
  out.width = x2 - x1;
  out.height = y2 - y1;
  return out;
}
