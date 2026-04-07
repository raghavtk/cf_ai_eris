export const SYSTEM_RULES = `
You are a strict, JSON-only API. You must adhere to the following rules:
Rule 1: NEVER output conversational text or markdown formatting (no \`\`\`json). Output RAW JSON only.
Rule 2: Ensure all requested fields are present, even if null. Provide intelligent fallback values if uncertain.
Rule 3: Follow strict typing for all fields as requested in the prompt.
Rule 4: If a task mentions "ASAP", "urgent", or "now", priority must be "high".
Rule 5: If a task is a meeting, call, or appointment, default estimated_duration to 60 unless specified otherwise.
`;

export const prompts = {
  parseTask: (input: string) => ([
    { role: "system", content: SYSTEM_RULES + "\nConvert text into structured JSON fields: title(string), description(string), priority('high'|'medium'|'low'), due_date(ISO string|null), category('work'|'personal'|'other'|null), subcategory(string|null), estimated_duration(number|null), note(string|null)." },
    { role: "user", content: `Parse this task: "${input}"` }
  ]),
  suggestPriority: (task: any) => ([
    { role: "system", content: SYSTEM_RULES + "\nGiven a task, suggest a priority. Return JSON: {\"priority\":\"high\"|\"medium\"|\"low\", \"reason\":\"brief explanation\"}" },
    { role: "user", content: `Task: Title: ${task.title} Description: ${task.description || ''} Due Date: ${task.due_date || ''}` }
  ]),
  estimateDuration: (task: any) => ([
    { role: "system", content: SYSTEM_RULES + "\nEstimate task duration. Return JSON: {\"estimated_minutes\": number, \"confidence\":\"high\"|\"medium\"|\"low\", \"reason\":\"brief explanation\"}" },
    { role: "user", content: `Task: Title: ${task.title} Description: ${task.description || ''}` }
  ]),
  categorizeTask: (task: any) => ([
    { role: "system", content: SYSTEM_RULES + "\nCategorize task into Work (Courses|Internship|Projects), Personal (Health|Social|Finance|Chores), or Other. Return JSON: {\"category\":\"work\"|\"personal\"|\"other\",\"subcategory\":\"one of allowed\",\"confidence\":0.0-1.0}" },
    { role: "user", content: `Task: Title: ${task.title} Description: ${task.description || ''}` }
  ]),
};

export const parseTaskWithHistory = (input: string, history: any[]) => {
  const historyMessages = history.map((h: any) => [
    { role: 'user', content: `Parse this task: "${h.input}"` },
    { role: 'assistant', content: JSON.stringify(h.parsed) }
  ]).flat();

  return [
    { role: "system", content: SYSTEM_RULES + "\nConvert text into structured JSON fields: title(string), description(string), priority('high'|'medium'|'low'), due_date(ISO string|null), category('work'|'personal'|'other'|null), subcategory(string|null), estimated_duration(number|null), note(string|null).\nIf the user is issuing a follow-up command (e.g., 'make it high priority'), apply that change to the LAST JSON object in context." },
    ...historyMessages,
    { role: "user", content: `Parse this task or follow-up command: "${input}"` }
  ];
};
