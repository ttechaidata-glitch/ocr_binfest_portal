import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import config from '../config.js';

/**
 * QR-based session manager.
 * - Admin generates a QR code
 * - Scanning the QR starts a time-limited session for the user
 * - When time expires, user must scan QR again
 */
class SessionManager {
  constructor() {
    // Active user sessions: sessionId -> { id, createdAt, expiresAt, qrCodeId }
    this.sessions = new Map();
    
    // Current QR code config (set by admin)
    this.currentQR = null; // { id, createdAt, durationMinutes, url }
    
    this.startCleanup();
  }

  /**
   * Generate a new QR code for session access
   * @param {number} durationMinutes - How long each session lasts
   * @param {string} baseUrl - Base URL for the session link
   * @returns {Promise<{id, url, qrDataUrl, durationMinutes}>}
   */
  async generateQRCode(durationMinutes, baseUrl) {
    const id = uuidv4();
    const sessionUrl = `${baseUrl}/session/${id}`;
    
    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(sessionUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    
    this.currentQR = {
      id,
      createdAt: Date.now(),
      durationMinutes,
      url: sessionUrl,
      qrDataUrl
    };
    
    console.log(`🔲 Generated new QR code (${durationMinutes} min sessions)`);
    console.log(`   URL: ${sessionUrl}`);
    
    return this.currentQR;
  }

  /**
   * Get the current QR code (if exists)
   */
  getCurrentQR() {
    return this.currentQR;
  }

  /**
   * Start a new user session from QR code scan
   * @param {string} qrId - The QR code ID that was scanned
   * @returns {object|null} - Session object or null if QR invalid
   */
  startSessionFromQR(qrId) {
    // Check if QR is valid
    if (!this.currentQR || this.currentQR.id !== qrId) {
      console.log(`❌ Invalid QR code: ${qrId?.slice(0, 8)}...`);
      return null;
    }
    
    // Create a new session for this user
    const sessionId = uuidv4();
    const now = Date.now();
    const expiresAt = now + this.currentQR.durationMinutes * 60 * 1000;
    
    const session = {
      id: sessionId,
      qrCodeId: qrId,
      createdAt: now,
      expiresAt,
      durationMinutes: this.currentQR.durationMinutes
    };
    
    this.sessions.set(sessionId, session);
    console.log(`📝 Started session ${sessionId.slice(0, 8)}... (${this.currentQR.durationMinutes} min)`);
    
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId) {
    if (!sessionId) return null;
    
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    // Check if expired
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    
    return session;
  }

  /**
   * Check if session is valid
   */
  isValid(sessionId) {
    return this.getSession(sessionId) !== null;
  }

  /**
   * Get time remaining in seconds
   */
  getTimeRemaining(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return 0;
    
    const remaining = Math.max(0, session.expiresAt - Date.now());
    return Math.floor(remaining / 1000);
  }

  /**
   * Get session status (for API response)
   */
  getSessionStatus(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      return { valid: false, remainingSeconds: 0 };
    }
    
    return {
      valid: true,
      remainingSeconds: this.getTimeRemaining(sessionId),
      expiresAt: session.expiresAt
    };
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpired() {
    const now = Date.now();
    let removed = 0;
    
    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`🧹 Cleaned up ${removed} expired session(s)`);
    }
  }

  /**
   * Start periodic cleanup
   */
  startCleanup() {
    setInterval(() => this.cleanupExpired(), 60000).unref?.();
  }

  /**
   * Get stats for admin
   */
  getStats() {
    return {
      activeSessions: this.sessions.size,
      hasQR: !!this.currentQR,
      qrCreatedAt: this.currentQR?.createdAt || null,
      qrDurationMinutes: this.currentQR?.durationMinutes || null
    };
  }
}

const sessionManager = new SessionManager();
export default sessionManager;
