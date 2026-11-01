/* Credential-free compiled result/ordinal/cache contract. Not database proof. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdarg.h>
#include <unistd.h>
#define lengthof(x) (sizeof(x)/sizeof((x)[0]))
typedef unsigned int Oid;
typedef struct { Oid oid; } CatalogId;
typedef struct { int objType, dump, components; CatalogId catId; } DumpableObject;
typedef struct { DumpableObject dobj; char relkind; } FuncInfo;
typedef FuncInfo TableInfo;
typedef struct { int remoteVersion; } Archive;
typedef struct { int status, rows, fields, cleared; } PGresult;
typedef struct { char data[65536]; } Buffer;
typedef Buffer *PQExpBuffer;
#define DO_FUNC 1
#define DO_TABLE 2
#define DO_TYPE 3
#define DO_AGG 4
#define DUMP_COMPONENT_DEFINITION 1
#define RELKIND_SEQUENCE 'S'
#define PGRES_TUPLES_OK 2
#define fmtQualifiedDumpable(t) "synthetic_sequence"
static const char *mode, *fault;
static int sent, delivered, cleared, created, requests, query_open, fields;
static PGresult results[20000];
static const char *names[] = {"proretset","prosrc","probin","provolatile","proisstrict","prosecdef","lanname","proconfig","procost","prorows","funcargs","funciargs","funcresult","proleakproof","protrftypes","proparallel","prokind","prosupport","prosqlbody"};
static const char *sequence_names[] = {"format_type","seqstart","seqincrement","seqmax","seqmin","seqcache","seqcycle"};
static void check_cleanup(void);
static void pg_fatal(const char *message) { (void)message; exit(23); }
static PQExpBuffer createPQExpBuffer(void) { return calloc(1,sizeof(Buffer)); }
static void destroyPQExpBuffer(PQExpBuffer b) { free(b); }
static void appendPQExpBuffer(PQExpBuffer b,const char *format,...) {
    va_list args;size_t used=strlen(b->data);int count;
    va_start(args,format);count=vsnprintf(b->data+used,sizeof(b->data)-used,format,args);va_end(args);
    if(count<0 || (size_t)count>=sizeof(b->data)-used)exit(102);
}
static void *GetConnection(Archive *a) { return a; }
static void ca_diag_query_begin(void) { if(query_open)exit(90); query_open=1; }
static void ca_diag_query_begin_subtype(int subtype){if(subtype!=1 && subtype!=4)exit(106);ca_diag_query_begin();}
static void ca_diag_query_end(void) { if(!query_open)exit(91); query_open=0; }
static int PQsendQuery(void *connection,const char *sql) {
    const char *at=sql;(void)connection;
    if(!strcmp(fault,"send"))return 0;
    fields=strstr(sql,"pg_catalog.pg_sequence")?7:19;
    sent=delivered=0;requests++;
    for(;*at;at++) {
        if(*at==';')sent++;
        if((!strcmp(mode,"mixed") || !strcmp(mode,"partial")) && !strncmp(at,"EXECUTE dumpFunc('",18)) {
            unsigned oid=0;
            if(sscanf(at,"EXECUTE dumpFunc('%u'",&oid)!=1 || oid%4!=1)exit(100);
        }
        if((!strcmp(mode,"seq-mixed") || !strcmp(mode,"seq-filter")) && !strncmp(at,"WHERE seqrelid = '",17)) {
            unsigned oid=0;
            if(sscanf(at,"WHERE seqrelid = '%u'",&oid)!=1 || oid%4!=1)exit(100);
        }
    }
    if(sent==0)sent=1; /* Original stock singleton has no semicolon. */
    if(sent<1||sent>128)exit(92);
    return 1;
}
static PGresult *PQgetResult(void *connection) {
    PGresult *r;(void)connection;
    if(!strcmp(fault,"interrupt") || (!strcmp(fault,"partial-interrupt") && delivered>0)){if(write(STDOUT_FILENO,"WAIT\n",5)!=5)exit(96);sleep(20);}
    if(delivered==sent+(!strcmp(fault,"extra")?1:0)-(!strcmp(fault,"missing")?1:0))return NULL;
    if(created>=20000)exit(103);
    delivered++;r=&results[created++];r->status=PGRES_TUPLES_OK;r->rows=1;r->fields=fields;
    if(!strcmp(fault,"status"))r->status=9;
    if(!strcmp(fault,"rows"))r->rows=0;
    if(!strcmp(fault,"fields"))r->fields=fields-1;
    return r;
}
static int PQresultStatus(PGresult *r){return r->status;}
static int PQntuples(PGresult *r){return r->rows;}
static int PQnfields(PGresult *r){return r->fields;}
static char *PQfname(PGresult *r,int f){return (char *)(!strcmp(fault,"name")?"wrong":r->fields==7?sequence_names[f]:names[f]);}
static int PQgetlength(PGresult *r,int row,int f){
    (void)row;(void)f;
    if(!strcmp(mode,"shared-bytes"))return r->fields==19?50000:2097152;
    if(!strcmp(mode,"shared-bytes-sequence-first"))return r->fields==7?130000:1000000;
    return !strcmp(fault,"bytes")?128*1024*1024:1;
}
static void PQclear(PGresult *r){if(r->cleared)exit(93);r->cleared=1;cleared++;}
static PGresult *ExecuteSqlQuery(Archive *a,const char *sql,int status){
    PGresult *r,*extra;(void)status;ca_diag_query_begin();
    if(!PQsendQuery(a,sql))pg_fatal("stock send");
    r=PQgetResult(a);extra=PQgetResult(a);ca_diag_query_end();
    if(extra){PQclear(extra);if(r)PQclear(r);pg_fatal("stock extra");}
    if(!r)pg_fatal("stock missing");
    return r;
}
static PGresult *ExecuteSqlQueryForSingleRow(Archive *a,const char *sql){return ExecuteSqlQuery(a,sql,PGRES_TUPLES_OK);}
#include "native-dump-function-batch.c"
#ifdef CA_SEQUENCE_STOCK_COUNTERFACTUAL
#include "native-dump-sequence-stock-reader.c"
#else
#include "native-dump-sequence-batch.c"
#endif
static void check_cleanup(void){if(cleared!=created || ca_metadata_cached_results || ca_metadata_cached_bytes)_Exit(98);}
int main(int argc,char **argv){
    Archive archive={170011};int i,n,selected=0;DumpableObject **objects;FuncInfo *items;
    bool sequence,interleave;
    if(argc!=3)return 94;
    mode=argv[1];fault=!strncmp(mode,"seq-",4)?mode+4:mode;n=atoi(argv[2]);
    sequence=!strncmp(mode,"seq-",4);interleave=!strncmp(mode,"interleave-",11)||!strncmp(mode,"shared-bytes",12);
    atexit(check_cleanup);
    objects=calloc(n,sizeof(*objects));items=calloc(n,sizeof(*items));
    for(i=0;i<n;i++){
        items[i].dobj=(DumpableObject){DO_FUNC,1,1,{(Oid)(i+1)}};
        if(i%137==136)items[i].dobj.objType=DO_TABLE;
        if(i%131==130)items[i].dobj.dump=0;
        if(!strcmp(mode,"excluded-boundary") && i%2==1){items[i].dobj.objType=DO_TABLE;items[i].dobj.dump=0;}
        if(!strcmp(mode,"mixed") || !strcmp(mode,"partial")){items[i].dobj.objType=1+i%4;items[i].dobj.dump=1;}
        if(sequence){
            items[i].dobj=(DumpableObject){DO_TABLE,1,1,{(Oid)(i+1)}};items[i].relkind=RELKIND_SEQUENCE;
            if(!strcmp(mode,"seq-mixed"))items[i].dobj.objType= i%4==0?DO_TABLE:i%4==1?DO_TABLE:i%4==2?DO_TYPE:DO_AGG;
            if(!strcmp(mode,"seq-mixed") && i%4==1)items[i].relkind='r';
            if(!strcmp(mode,"seq-filter")){
                if(i%4==1)items[i].dobj.dump=2;
                if(i%4==2)items[i].dobj.components=0;
                if(i%4==3)items[i].relkind='r';
            }
        }
        if(interleave){
            bool seqfirst=strstr(mode,"sequence-first")!=NULL;
            items[i].dobj=(DumpableObject){(i%2==0)==seqfirst?DO_TABLE:DO_FUNC,1,1,{(Oid)(i+1)}};
            items[i].relkind=RELKIND_SEQUENCE;
        }
        objects[i]=&items[i].dobj;
    }
    ca_batch_objects=objects;ca_batch_objects_count=n;
    for(i=0;i<n;i++){
        PGresult *r;char query[256];ca_batch_position=i;
        if(objects[i]->objType==DO_FUNC && objects[i]->dump){
            if(!strcmp(mode,"order") && i==1)ca_batch_oids[ca_batch_next]=99999;
            snprintf(query,sizeof(query),"EXECUTE dumpFunc('%u')",objects[i]->catId.oid);
            r=ca_function_batch_result(&archive,&items[i],query);selected++;PQclear(r);
        }else if(objects[i]->objType==DO_TABLE && items[i].relkind==RELKIND_SEQUENCE &&
                 (objects[i]->dump & objects[i]->components & DUMP_COMPONENT_DEFINITION)){
#ifndef CA_SEQUENCE_STOCK_COUNTERFACTUAL
            if(!strcmp(mode,"seq-order") && i==1)ca_sequence_oids[ca_sequence_next]=99999;
#endif
            snprintf(query,sizeof(query),"SELECT format_type(seqtypid, NULL), seqstart, seqincrement, seqmax, seqmin, seqcache, seqcycle FROM pg_catalog.pg_sequence WHERE seqrelid = '%u'::oid",objects[i]->catId.oid);
            r=ca_sequence_batch_result(&archive,&items[i],query);selected++;PQclear(r);
            if(!strcmp(mode,"seq-partial"))exit(23);
        }else{
            if(query_open || delivered!=sent)return 99;
            if(!strcmp(mode,"partial"))exit(23);
        }
        if(ca_metadata_cached_results>128 || ca_metadata_cached_bytes>128*1024*1024)return 104;
    }
    if(ca_batch_count!=ca_batch_next || query_open || ca_metadata_cached_results || ca_metadata_cached_bytes)return 95;
    if(!strcmp(mode,"mixed") || !strcmp(mode,"seq-mixed") || !strcmp(mode,"seq-filter")){
        if(requests!=(selected+127)/128 || cleared!=selected)return 97;
    }else if(sequence){if(requests!=(n+127)/128)return 97;}
    else if(interleave){if(n==257 && requests!=130)return 105;}
    else if(!strcmp(mode,"excluded-boundary")){if(requests!=1)return 97;}
    else if(n>128 && requests<2)return 95;
    free(objects);free(items);return 0;
}
