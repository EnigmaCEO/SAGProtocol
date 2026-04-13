import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  meta?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}

export default function PageHeader({
  title,
  description,
  meta,
  actions,
  eyebrow,
}: PageHeaderProps) {
  return (
    <div className="sagitta-hero">
      <div className="sagitta-cell page-header">
        <div className="page-header__copy">
          {eyebrow ? <div className="page-header__eyebrow">{eyebrow}</div> : null}
          <h2 className="page-header__title">{title}</h2>
          <p className="page-header__description">{description}</p>
          {meta ? <div className="page-header__meta">{meta}</div> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
