import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ArrowLeft, Cpu } from 'lucide-react';

export const GeneratePlaceholderPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardContent className="py-20">
          <EmptyState
            icon={<Cpu className="w-8 h-8 text-navy" />}
            title="Module 3: Timetable engine, coming next"
            description="All input datasets have passed deterministic rule-based validation and clean normalized tables have been written to the database. The Python OR-Tools constraint solver will schedule timetable slots in Module 3."
            action={
              <div className="flex items-center gap-3 pt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate('/validation')}
                  icon={<ArrowLeft className="w-3.5 h-3.5" />}
                >
                  Back to Validation
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/')}
                >
                  Overview Dashboard
                </Button>
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
};
