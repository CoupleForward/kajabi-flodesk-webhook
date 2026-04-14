export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const FLODESK_API_KEY = process.env.FLODESK_API_KEY;
  if (!FLODESK_API_KEY) {
    console.error('FLODESK_API_KEY not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const SEGMENT_NAME = process.env.FLODESK_SEGMENT_NAME || 'One Day Mini Workshop';

  try {
    const payload = req.body;
    console.log('Kajabi webhook received:', JSON.stringify(payload, null, 2));

    const contact = payload.contact || {};
    const primaryEmail = contact.email || payload.email;
    const firstName = contact.first_name || payload.first_name || '';
    const lastName = contact.last_name || payload.last_name || '';

    if (!primaryEmail) {
      console.error('No primary email in webhook payload');
      return res.status(400).json({ error: 'No email provided' });
    }

    const authHeader = 'Basic ' + Buffer.from(FLODESK_API_KEY + ':').toString('base64');
    const segmentId = await getOrCreateSegment(SEGMENT_NAME, authHeader);
    await upsertAndSegment(primaryEmail, firstName, lastName, segmentId, authHeader);
    console.log('Primary subscriber added: ' + primaryEmail);

    const partnerEmail = extractField(payload, 'partner_email') ||
                         extractField(payload, 'partner email') ||
                         extractField(payload, 'Partner email');
    const partnerName = extractField(payload, 'partner_full_name') ||
                        extractField(payload, 'partner full name') ||
                        extractField(payload, 'Partner full name') ||
                        extractField(payload, 'partner_name');

    if (partnerEmail) {
      const [partnerFirst, ...partnerLastParts] = (partnerName || '').split(' ');
      const partnerLast = partnerLastParts.join(' ');
      await upsertAndSegment(partnerEmail, partnerFirst || '', partnerLast || '', segmentId, authHeader);
      console.log('Partner subscriber added: ' + partnerEmail);
    }

    return res.status(200).json({
      success: true,
      primary: primaryEmail,
      partner: partnerEmail || null,
      segment: SEGMENT_NAME
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function upsertAndSegment(email, firstName, lastName, segmentId, authHeader) {
  const subRes = await fetch('https://api.flodesk.com/v1/subscribers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
      'User-Agent': 'CoupleForward/1.0 (coupleforward.com)'
    },
    body: JSON.stringify({
      email: email,
      first_name: firstName,
      last_name: lastName,
      ...(segmentId ? { segment_ids: [segmentId] } : {})
    })
  });
  if (!subRes.ok) {
    const errBody = await subRes.text();
    throw new Error('Flodesk create subscriber failed (' + subRes.status + '): ' + errBody);
  }
  const subscriber = await subRes.json();
  if (segmentId) {
    const segRes = await fetch('https://api.flodesk.com/v1/subscribers/' + subscriber.id + '/segments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'User-Agent': 'CoupleForward/1.0 (coupleforward.com)'
      },
      body: JSON.stringify({ segment_ids: [segmentId] })
    });
    if (!segRes.ok) {
      const errBody = await segRes.text();
      console.error('Segment add failed for ' + email + ': ' + errBody);
    }
  }
  return subscriber;
}

async function getOrCreateSegment(name, authHeader) {
  const listRes = await fetch('https://api.flodesk.com/v1/segments', {
    headers: {
      'Authorization': authHeader,
      'User-Agent': 'CoupleForward/1.0 (coupleforward.com)'
    }
  });
  if (listRes.ok) {
    const segments = await listRes.json();
    const existing = (segments.data || segments).find(
      s => s.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing.id;
  }
  const createRes = await fetch('https://api.flodesk.com/v1/segments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
      'User-Agent': 'CoupleForward/1.0 (coupleforward.com)'
    },
    body: JSON.stringify({ name: name, color: '#5ec6ca' })
  });
  if (!createRes.ok) {
    const errBody = await createRes.text();
    throw new Error('Failed to create segment: ' + errBody);
  }
  const newSegment = await createRes.json();
  return newSegment.id;
}

function extractField(payload, fieldName) {
  if (payload[fieldName]) return payload[fieldName];
  if (payload.contact && payload.contact[fieldName]) return payload.contact[fieldName];
  if (payload.custom_fields && payload.custom_fields[fieldName]) return payload.custom_fields[fieldName];
  if (Array.isArray(payload.additional_fields)) {
    const field = payload.additional_fields.find(
      f => f.name === fieldName || f.label === fieldName || f.key === fieldName
    );
    if (field) return field.value;
  }
  if (payload.offer) {
    if (payload.offer[fieldName]) return payload.offer[fieldName];
    if (payload.offer.custom_fields && payload.offer.custom_fields[fieldName]) return payload.offer.custom_fields[fieldName];
  }
  if (Array.isArray(payload.answers)) {
    const answer = payload.answers.find(
      a => a.question && a.question.toLowerCase().includes(fieldName.toLowerCase())
    );
    if (answer) return answer.answer || answer.value;
  }
  return null;
}
