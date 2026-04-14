// Health check — hit this URL to confirm deployment is live
export default function handler(req, res) {
  return res.status(200).json({
    status: 'ok',
    service: 'Kajabi → Flodesk webhook',
    brand: 'Couple Forward',
    segment: process.env.FLODESK_SEGMENT_NAME || 'One Day Mini Workshop',
    timestamp: new Date().toISOString()
  });
}
