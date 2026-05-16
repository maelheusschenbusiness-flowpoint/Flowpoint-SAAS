'use strict';

const OpenAI =
  require('openai');

const client =
  process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY,
      })
    : null;

async function generateAIResponse({

  user,
  message,
  audits=[],
  monitors=[],
  missions=[],

}) {

  if (!client) {

    return `
FlowPoint AI indisponible.

Ajoute OPENAI_API_KEY
dans ton .env.
`;
  }

  const prompt = `

Tu es l’assistant enterprise FlowPoint.

Utilisateur:
${user.firstName}

Plan:
${user.plan}

Message:
${message}

Audits:
${JSON.stringify(audits).slice(0, 3000)}

Monitors:
${JSON.stringify(monitors).slice(0, 3000)}

Missions:
${JSON.stringify(missions).slice(0, 3000)}

Donne:
- analyse business
- quick wins
- problèmes critiques
- recommandations SEO
- recommandations conversion
- recommandations techniques
`;

  const completion =
    await client.chat.completions.create({

      model:
        'gpt-4o-mini',

      messages: [

        {
          role: 'system',
          content:
            'Tu es FlowPoint AI.',
        },

        {
          role: 'user',
          content: prompt,
        },

      ],

      temperature: 0.7,
    });

  return (
    completion.choices?.[0]
      ?.message?.content ||
    'Aucune réponse.'
  );
}

module.exports = {
  generateAIResponse,
};
