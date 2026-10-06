import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';

export const ValidationPlaceholderPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardContent className="py-16">
          <EmptyState
            icon={<ShieldCheck className="w-6 h-6 text-navy" />}
            title="Module 2: Rule-based ETL"
            description="Validation runs here in the next module. Data cleaning, entity cross-referencing, and conflict detection will execute at this stage."
            action={
              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate('/')}
                  icon={<ArrowLeft className="w-3.5 h-3.5" />}
                >
                  Return to Overview
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/uploads')}
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  Inspect Uploads
                </Button>
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
};
