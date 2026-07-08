/**
 * Immutable 2D vector. Every operation returns a new Vec2.
 *
 * All physics code uses these in SI units: positions in meters,
 * velocities in m/s, accelerations in m/s^2, angles in radians.
 */
export class Vec2 {
  static readonly ZERO = new Vec2(0, 0);

  constructor(
    public readonly x: number = 0,
    public readonly y: number = 0,
  ) {}

  /** Unit (or `length`-long) vector pointing at `radians`, measured CCW from +X. */
  static fromAngle(radians: number, length = 1): Vec2 {
    return new Vec2(Math.cos(radians) * length, Math.sin(radians) * length);
  }

  add(o: Vec2): Vec2 {
    return new Vec2(this.x + o.x, this.y + o.y);
  }

  sub(o: Vec2): Vec2 {
    return new Vec2(this.x - o.x, this.y - o.y);
  }

  scale(k: number): Vec2 {
    return new Vec2(this.x * k, this.y * k);
  }

  dot(o: Vec2): number {
    return this.x * o.x + this.y * o.y;
  }

  /** 2D cross product: the z component of the equivalent 3D cross product. */
  cross(o: Vec2): number {
    return this.x * o.y - this.y * o.x;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

  distanceTo(o: Vec2): number {
    return Math.hypot(this.x - o.x, this.y - o.y);
  }

  /** Returns Vec2.ZERO for the zero vector instead of NaN. */
  normalized(): Vec2 {
    const len = this.length();
    return len < 1e-12 ? Vec2.ZERO : new Vec2(this.x / len, this.y / len);
  }

  /** Angle in radians, CCW from +X (atan2 convention). */
  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  rotated(radians: number): Vec2 {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }
}
