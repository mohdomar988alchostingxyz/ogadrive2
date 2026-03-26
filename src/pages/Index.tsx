import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HardDrive, Cloud, Bot } from 'lucide-react';
import DriveApp from '@/components/DriveApp';
import B2App from '@/components/B2App';
import AIChat from '@/components/AIChat';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Tabs defaultValue="drive" className="w-full">
        <div className="border-b border-border bg-card">
          <div className="max-w-6xl mx-auto px-4">
            <TabsList className="bg-transparent h-12 gap-2">
              <TabsTrigger value="drive" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <HardDrive className="h-4 w-4" />
                Google Drive
              </TabsTrigger>
              <TabsTrigger value="b2" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <Cloud className="h-4 w-4" />
                Backblaze B2
              </TabsTrigger>
              <TabsTrigger value="ai" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <Bot className="h-4 w-4" />
                AI Chat
              </TabsTrigger>
            </TabsList>
          </div>
        </div>
        <TabsContent value="drive" className="mt-0">
          <DriveApp />
        </TabsContent>
        <TabsContent value="b2" className="mt-0">
          <B2App />
        </TabsContent>
        <TabsContent value="ai" className="mt-0 p-4">
          <AIChat />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Index;
