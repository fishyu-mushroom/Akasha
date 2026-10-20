import React from "react";
import { Container } from "@mantine/core";
import { useAtom } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom";
import { TitleEditor } from "@/features/editor/title-editor";
import { DeletedPageBanner } from "@/features/page/trash/components/deleted-page-banner";
import classes from "@/features/editor/styles/editor.module.css";
import { DatabaseView } from "./database-view";

const MemoizedTitleEditor = React.memo(TitleEditor);

interface DatabasePageProps {
  pageId: string;
  slugId: string;
  title: string;
  spaceSlug: string;
  editable: boolean;
}

/** Full-page database: page title plus the database views. */
export function DatabasePage({
  pageId,
  slugId,
  title,
  spaceSlug,
  editable,
}: DatabasePageProps) {
  const [user] = useAtom(userAtom);
  const fullPageWidth = user.settings?.preferences?.fullPageWidth ?? true;

  return (
    <Container
      fluid={fullPageWidth}
      size={!fullPageWidth && 900}
      className={classes.editor}
    >
      <DeletedPageBanner slugId={slugId} />
      <MemoizedTitleEditor
        pageId={pageId}
        slugId={slugId}
        title={title}
        spaceSlug={spaceSlug}
        editable={editable}
      />
      <DatabaseView databaseId={pageId} />
    </Container>
  );
}
