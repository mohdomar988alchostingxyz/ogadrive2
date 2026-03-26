import { useState } from 'react';
import { callClaude, callGroq, Message } from '../lib/openrouterApi';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

export default function AIChat() {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCall = async (model: 'claude' | 'groq') => {
    if (!input.trim()) return;
    setLoading(true);
    setResponse('');
    try {
      const messages: Message[] = [{ role: 'user', content: input }];
      const result = model === 'claude' ? await callClaude(messages) : await callGroq(messages);
      setResponse(result);
    } catch (error) {
      setResponse(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>AI Chat</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="Enter your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={4}
        />
        <div className="flex gap-2">
          <Button onClick={() => handleCall('claude')} disabled={loading}>
            Ask Claude
          </Button>
          <Button onClick={() => handleCall('groq')} disabled={loading}>
            Ask Groq
          </Button>
        </div>
        {loading && <p>Loading...</p>}
        {response && (
          <div className="p-4 bg-gray-100 rounded">
            <pre className="whitespace-pre-wrap">{response}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}